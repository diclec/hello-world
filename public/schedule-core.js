/* Shared calendar-day scheduling rules used by the server and browser. */
globalThis.PmoSchedule = (() => {
  const DAY = 86400000;
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value && value >= '1900-01-01' && value <= '2200-12-31';
  const shift = (date, days) => { const value = new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10); if (!validDate(value)) fail('Schedule dates must be between 1900 and 2200'); return value; };
  const span = (start, finish) => Math.round((Date.parse(finish) - Date.parse(start)) / DAY) + 1;
  const progress = task => task.percentComplete ?? (task.status === 'Done' ? 100 : 0);
  function prepare(input, old, record) {
    const t = { ...record };
    if (input.majorMilestone !== undefined && typeof input.majorMilestone !== 'boolean') fail('Major milestone must be true or false');
    for (const key of ['parentId', 'startDate', 'finishDate']) if (input[key] !== undefined && typeof input[key] !== 'string') fail('Invalid ' + key);
    // The requested start remains separate from calculated dates so successors can move in either direction.
    delete t.wbs; delete t.depth; delete t.summary;
    delete t.scheduleOrder; if (old?.scheduleOrder !== undefined) t.scheduleOrder = old.scheduleOrder;
    if (Object.hasOwn(input, 'scheduleStart') && input.scheduleStart !== old?.scheduleStart) fail('Use Start Date to set a task start');
    if (input.startDate !== undefined && (!old || input.startDate !== (old.startDate || ''))) t.scheduleStart = input.startDate;
    if (!old && input.dependsOn?.length && input.startDate === undefined) t.scheduleStart = '';
    if (input.startDate === '' && old?.startDate) t.due = '';
    for (const key of ['duration', 'percentComplete']) if (input[key] !== undefined) {
      const n = input[key];
      if (typeof n !== 'number' || !Number.isFinite(n) || (key === 'duration' && (!Number.isInteger(n) || n < 0 || n > 36500)) || (key === 'percentComplete' && (n < 0 || n > 100))) fail(key === 'duration' ? 'Duration must be a whole number from 0 to 36500 days' : 'Percent complete must be between 0 and 100');
    }
    if (input.finishDate && !validDate(input.finishDate)) fail('Use a valid Finish Date');
    if (input.startDate && !validDate(input.startDate)) fail('Use a valid Start Date');
    if (input.finishDate && (!old || input.finishDate !== old.finishDate) && input.duration === undefined) {
      const start = input.startDate || old?.startDate;
      if (!validDate(start) || input.finishDate < start) fail('Finish Date must be on or after Start Date');
      t.duration = span(start, input.finishDate);
    }
    if (input.finishDate && input.duration !== undefined && input.startDate && input.finishDate !== shift(input.startDate, Math.max(input.duration - 1, 0))) fail('Finish Date must match Start Date and Duration');
    if (input.finishDate && !input.startDate && !old?.startDate) fail('Enter Start Date or use a scheduled predecessor');
    if (input.status !== undefined && old && input.status !== old.status) {
      t.percentComplete = input.status === 'Done' ? 100 : old.status === 'Done' ? 0 : progress(old);
    } else if (input.percentComplete !== undefined) {
      t.status = input.percentComplete === 100 ? 'Done' : t.status === 'Blocked' ? 'Blocked' : input.percentComplete > 0 ? 'In progress' : 'To do';
    } else if (input.status === 'Done') t.percentComplete = 100;
    return t;
  }
  function calculate(source) {
    if (source.length > 1500) fail('A project schedule supports up to 1500 tasks');
    const tasks = source.map((t, i) => ({ ...t, scheduleOrder: t.scheduleOrder ?? i + 1 })).sort((a, b) => a.scheduleOrder - b.scheduleOrder), byId = new Map(tasks.map(t => [t.id, t]));
    const children = new Map([['', []]]);
    for (const t of tasks) {
      if (t.majorMilestone !== undefined && typeof t.majorMilestone !== 'boolean') fail('Invalid major milestone');
      if (t.parentId !== undefined && typeof t.parentId !== 'string') fail('Invalid parent task');
      if (t.parentId && (!byId.has(t.parentId) || t.parentId === t.id)) fail('Parent task must be another task in this project');
      if (t.dependsOn !== undefined && (!Array.isArray(t.dependsOn) || t.dependsOn.length > 100 || t.dependsOn.some(id => typeof id !== 'string') || new Set(t.dependsOn).size !== t.dependsOn.length)) fail('Select up to 100 distinct predecessors');
      for (const id of t.dependsOn || []) if (id === t.id || !byId.has(id)) fail('Predecessors must be other tasks in this project');
      for (const key of ['scheduleStart', 'startDate', 'finishDate']) if (t[key] && !validDate(t[key])) fail('Use valid schedule dates between 1900 and 2200');
      if (t.duration !== undefined && (!Number.isInteger(t.duration) || t.duration < 0 || t.duration > 36500)) fail('Invalid duration');
      if (t.percentComplete !== undefined && (typeof t.percentComplete !== 'number' || !Number.isFinite(t.percentComplete) || t.percentComplete < 0 || t.percentComplete > 100)) fail('Invalid percent complete');
      const parent = t.parentId || ''; if (!children.has(parent)) children.set(parent, []); children.get(parent).push(t);
    }
    const rows = [], treePath = new Set();
    function walk(parent, prefix = '', depth = 0) {
      if (depth > 30) fail('Task nesting is limited to 30 levels');
      (children.get(parent) || []).forEach((t, i) => {
        if (treePath.has(t.id)) fail('Circular task hierarchy');
        treePath.add(t.id); const wbs = prefix ? prefix + '.' + (i + 1) : String(i + 1);
        rows.push({ task: t, wbs, depth, summary: !!children.get(t.id)?.length }); walk(t.id, wbs, depth + 1); treePath.delete(t.id);
      });
    }
    walk(''); if (rows.length !== tasks.length) fail('Circular task hierarchy');
    for (const t of tasks) {
      if (children.get(t.id)?.length && t.dependsOn?.length) fail('Summary tasks cannot have predecessors. Link their subtasks instead.');
      if ((t.dependsOn || []).some(id => children.get(id)?.length)) fail('Link to a leaf task or milestone, rather than a summary task');
    }
    const visiting = new Set(), done = new Set();
    function schedule(t) {
      if (done.has(t.id)) return;
      if (visiting.has(t.id)) fail('Circular task dependency');
      visiting.add(t.id);
      const sub = children.get(t.id) || [];
      if (sub.length) {
        sub.forEach(schedule);
        const dated = sub.filter(c => c.startDate && c.finishDate);
        t.startDate = dated.length ? dated.map(c => c.startDate).sort()[0] : '';
        t.finishDate = dated.length ? dated.map(c => c.finishDate).sort().at(-1) : '';
        t.duration = dated.length ? span(t.startDate, t.finishDate) : 0;
        const leaves = [];
        const collect = id => (children.get(id) || []).forEach(c => children.get(c.id)?.length ? collect(c.id) : leaves.push(c)); collect(t.id);
        const weight = leaves.reduce((s, c) => s + Math.max(c.duration || 1, 1), 0);
        t.percentComplete = Math.round(leaves.reduce((s, c) => s + progress(c) * Math.max(c.duration || 1, 1), 0) / weight);
        t.status = leaves.every(c => progress(c) === 100) ? 'Done' : leaves.some(c => c.status === 'Blocked') ? 'Blocked' : leaves.some(c => progress(c) > 0 || c.status === 'In progress') ? 'In progress' : 'To do';
        t.due = t.finishDate;
      } else {
        let start = t.dependsOn?.length ? '' : t.scheduleStart ?? t.startDate ?? '';
        for (const id of t.dependsOn || []) {
          const predecessor = byId.get(id); schedule(predecessor);
          if (!predecessor.finishDate) fail('Schedule predecessor "' + predecessor.name + '" before linking it');
          const earliest = predecessor.finishDate;
          if (!start || earliest > start) start = earliest;
        }
        if (start) {
          t.duration ??= 1; t.startDate = start; t.finishDate = shift(start, Math.max(t.duration - 1, 0)); t.due = t.finishDate;
        } else if (t.scheduleStart !== undefined) { const wasScheduled = !!t.startDate || !!t.finishDate; t.startDate = ''; t.finishDate = ''; if (wasScheduled) t.due = ''; }
      }
      visiting.delete(t.id); done.add(t.id);
    }
    tasks.forEach(schedule);
    return { tasks, rows };
  }
  return { validDate, shift, span, progress, prepare, calculate };
})();
