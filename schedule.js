import './public/schedule-core.js';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function createSchedule({ all, put, auth, db }) {
  function save(actor, input, old, record) {
    const existing = all('tasks');
    if (old && old.projectId !== record.projectId && (old.parentId || old.dependsOn?.length || existing.some(t => t.parentId === old.id || t.dependsOn?.includes(old.id)))) fail(400, 'Detach task hierarchy and dependencies before moving between projects');
    const prepared = PmoSchedule.prepare(input, old, record);
    prepared.scheduleOrder = (old?.projectId === record.projectId ? old?.scheduleOrder : undefined) ?? Math.max(0, ...existing.filter(t => t.projectId === record.projectId).map((t, i) => t.scheduleOrder ?? i + 1)) + 1;
    if (old && old.scheduleOrder === undefined && old.projectId === record.projectId) prepared.scheduleOrder = existing.filter(t => t.projectId === record.projectId).findIndex(t => t.id === old.id) + 1;
    const source = existing.filter(t => t.projectId === record.projectId && t.id !== record.id);
    // Keep insertion order stable: WBS numbering follows task creation order within each parent.
    const oldIndex = existing.filter(t => t.projectId === record.projectId).findIndex(t => t.id === record.id);
    source.splice(oldIndex < 0 ? source.length : oldIndex, 0, prepared);
    const calculated = PmoSchedule.calculate(source).tasks;
    let result;
    auth.transaction(() => {
      for (const task of calculated) {
        const prior = existing.find(t => t.id === task.id);
        if (task.id !== record.id && JSON.stringify(task) === JSON.stringify(prior)) continue;
        const saved = task.id === record.id ? task : { ...task, revision: task.revision + 1, updatedBy: actor.id, updatedAt: record.updatedAt };
        put('tasks', saved);
        auth.audit(actor, task.id === record.id ? 'tasks' + (old ? '.updated' : '.created') : 'schedule.recalculated', saved.id, { projectId: saved.projectId, revision: saved.revision });
        if (task.id === record.id) result = saved;
      }
    });
    return result;
  }
  function remove(actor, id, input) {
    const tasks = all('tasks'), task = tasks.find(t => t.id === id);
    if (!task || !auth.canRead(actor, task.projectId)) fail(404, 'Task not found');
    auth.authorizeWrite(actor, 'tasks', task, input);
    if (task.revision !== input.revision) fail(409, 'This task changed. Refresh and try again.');
    if (all('projects').find(p => p.id === task.projectId)?.status === 'Closed') fail(409, 'Closed projects are read-only');
    if (tasks.some(t => t.parentId === id || t.dependsOn?.includes(id))) fail(409, 'Move subtasks and remove successor links before deleting this task');
    const calculated = PmoSchedule.calculate(tasks.filter(t => t.projectId === task.projectId && t.id !== id)).tasks;
    auth.transaction(() => {
      db.prepare("DELETE FROM records WHERE kind='tasks' AND id=?").run(id);
      auth.audit(actor, 'tasks.deleted', id, { projectId: task.projectId });
      for (const updated of calculated) {
        const prior = tasks.find(t => t.id === updated.id);
        if (JSON.stringify(updated) === JSON.stringify(prior)) continue;
        const saved = { ...updated, revision: updated.revision + 1, updatedBy: actor.id, updatedAt: new Date().toISOString() };
        put('tasks', saved); auth.audit(actor, 'schedule.recalculated', saved.id, { projectId: saved.projectId, revision: saved.revision });
      }
    });
  }
  return { save, remove };
}
