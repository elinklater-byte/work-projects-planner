import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus, X, Trash2, Calendar, Search, ArrowRight,
  CheckCircle2, Circle, Pin, LayoutGrid, RotateCcw,
  ChevronDown, ChevronUp, List as ListIcon,
} from 'lucide-react';

const STATUSES = ['Backlog', 'In Progress', 'Review', 'Done']; // Kanban column for a project
const PRIORITIES = ['Low', 'Medium', 'High']; // project-level priority
const TASK_STATES = ['In Progress', 'Not Scheduled', 'Done']; // per-item status
const TASK_PRIORITIES = ['High', 'Moderate', 'Low', 'Very Low', 'No Priority']; // per-item priority

const COLORS = {
  paper: '#EDEAE1',
  paperDark: '#DCD6C6',
  ink: '#232420',
  inkSoft: '#77756B',
  pine: '#2F6B57',
  pineLight: '#E4EEE9',
  rose: '#B3433F',
  roseLight: '#F5E1DF',
  amber: '#B8842E',
  amberLight: '#F3E7D2',
  sky: '#3E6E8E',
  skyLight: '#DFE9EF',
  card: '#FBF9F4',
  border: '#D9D2BF',
};

const NOTE_PALETTE = [
  { bg: '#F4E3A1', text: '#4A3B12', pin: '#C9A227' },
  { bg: '#C9DCE6', text: '#1F3A47', pin: '#4A7891' },
  { bg: '#EFCBC9', text: '#5B2323', pin: '#B3433F' },
  { bg: '#D3E0C4', text: '#2E3B1E', pin: '#5C7A3C' },
  { bg: '#DCD3E8', text: '#372B4A', pin: '#7C5FA3' },
];

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function priorityColor(p) {
  if (p === 'High') return { fg: COLORS.rose, bg: COLORS.roseLight };
  if (p === 'Low') return { fg: COLORS.sky, bg: COLORS.skyLight };
  return { fg: COLORS.amber, bg: COLORS.amberLight };
}

function stateColor(s) {
  if (s === 'Done') return { fg: COLORS.pine, bg: COLORS.pineLight };
  if (s === 'In Progress') return { fg: COLORS.amber, bg: COLORS.amberLight };
  return { fg: COLORS.inkSoft, bg: COLORS.paperDark }; // Not Scheduled
}

function taskPriorityColor(p) {
  if (p === 'High') return { fg: COLORS.rose, bg: COLORS.roseLight };
  if (p === 'Moderate') return { fg: COLORS.amber, bg: COLORS.amberLight };
  if (p === 'Low') return { fg: COLORS.sky, bg: COLORS.skyLight };
  if (p === 'Very Low') return { fg: COLORS.inkSoft, bg: COLORS.paperDark };
  return { fg: COLORS.inkSoft, bg: COLORS.card }; // No Priority
}

function rotationFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(hash) % 7) - 3) * 1.1;
}

function formatDue(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d - today) / 86400000);
  const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { label, diffDays, overdue: diffDays < 0 };
}

const clamp2 = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

// ---------- backward-compatible item helpers ----------
// Older saved data only has a boolean `done`, or a `state` from the earlier
// 4-value system (To Do / Scheduled / In Progress / Completed). This maps
// everything onto the current 3-value system so nothing has to be migrated
// on load — old and new shapes both just work.
const LEGACY_STATE_MAP = {
  'To Do': 'Not Scheduled',
  'Scheduled': 'Not Scheduled',
  'In Progress': 'In Progress',
  'Completed': 'Done',
};

function getItemState(item) {
  if (item && item.state) return LEGACY_STATE_MAP[item.state] || item.state;
  if (item && item.done) return 'Done';
  return 'Not Scheduled';
}

function getItemPriority(item) {
  return (item && item.priority) || 'No Priority';
}

function isItemDone(item) {
  return getItemState(item) === 'Done';
}

function toggledState(item) {
  return isItemDone(item) ? 'Not Scheduled' : 'Done';
}

// Recursively counts every task + subtask + sub-subtask under a project.
function countProgress(tasks) {
  let total = 0;
  let done = 0;
  (tasks || []).forEach(t => {
    total += 1;
    if (isItemDone(t)) done += 1;
    (t.subtasks || []).forEach(s => {
      total += 1;
      if (isItemDone(s)) done += 1;
      (s.subtasks || []).forEach(ss => {
        total += 1;
        if (isItemDone(ss)) done += 1;
      });
    });
  });
  return { total, done };
}

// ---------- external dashboard sync ----------
// Best-effort push to the daily dashboard whenever a due date is set on a
// task/subtask/sub-subtask. This posts to a serverless function that doesn't
// exist yet in this project — see the note at the bottom of the chat reply
// for what's needed to wire it up to the real Notion database. Until then
// this just fails silently and the rest of the app is unaffected.
async function pushDueDateToDashboard({ title, dueDate, projectTitle }) {
  if (!dueDate) return;
  try {
    await fetch('/api/dashboard-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        dueDate,
        category: 'Work',
        subcategory: 'Work Projects',
        priority: 'Moderate',
        project: projectTitle,
      }),
    });
  } catch (e) {
    // Best-effort only — never let a sync failure break the board.
  }
}

export default function WorkBoard() {
  const [tab, setTab] = useState('projects');
  const [boardView, setBoardView] = useState('list'); // 'board' | 'list'
  const [projects, setProjects] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [search, setSearch] = useState('');
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [dragOverStatus, setDragOverStatus] = useState(null);
  const [resetArmed, setResetArmed] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      let p = [];
      let n = [];
      try {
        const pr = await window.storage.get('wd-projects');
        if (pr && pr.value) p = JSON.parse(pr.value);
      } catch (e) { /* nothing saved yet */ }
      try {
        const nr = await window.storage.get('wd-notes');
        if (nr && nr.value) n = JSON.parse(nr.value);
      } catch (e) { /* nothing saved yet */ }
      if (mounted) {
        setProjects(Array.isArray(p) ? p : []);
        setNotes(Array.isArray(n) ? n : []);
        setLoaded(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const persistProjects = useCallback(async (next) => {
    setProjects(next);
    try {
      const res = await window.storage.set('wd-projects', JSON.stringify(next));
      if (!res) setStorageError(true);
    } catch (e) { setStorageError(true); }
  }, []);

  const persistNotes = useCallback(async (next) => {
    setNotes(next);
    try {
      const res = await window.storage.set('wd-notes', JSON.stringify(next));
      if (!res) setStorageError(true);
    } catch (e) { setStorageError(true); }
  }, []);

  function addProject(data) {
    const newProj = {
      id: uid(),
      title: data.title.trim(),
      description: data.description || '',
      status: data.status || 'Backlog',
      priority: data.priority || 'Medium',
      dueDate: data.dueDate || '',
      tasks: [],
      createdAt: Date.now(),
    };
    persistProjects([newProj, ...projects]);
    setShowNewProject(false);
  }

  function updateProject(id, patch) {
    persistProjects(projects.map(p => (p.id === id ? { ...p, ...patch } : p)));
  }

  function deleteProject(id) {
    persistProjects(projects.filter(p => p.id !== id));
    if (activeProjectId === id) setActiveProjectId(null);
  }

  // ---------- tasks ----------
  function addTask(projectId, text) {
    if (!text.trim()) return;
    persistProjects(projects.map(p => (
      p.id === projectId
        ? { ...p, tasks: [...p.tasks, { id: uid(), text: text.trim(), state: 'Not Scheduled', priority: 'No Priority', dueDate: '', notes: '', subtasks: [] }] }
        : p
    )));
  }

  function updateTask(projectId, taskId, patch) {
    persistProjects(projects.map(p => (
      p.id === projectId
        ? { ...p, tasks: p.tasks.map(t => (t.id === taskId ? { ...t, ...patch } : t)) }
        : p
    )));
    if (patch.dueDate) {
      const proj = projects.find(p => p.id === projectId);
      const t = proj && proj.tasks.find(tk => tk.id === taskId);
      pushDueDateToDashboard({ title: (t && t.text) || 'Task', dueDate: patch.dueDate, projectTitle: (proj && proj.title) || '' });
    }
  }

  function deleteTask(projectId, taskId) {
    persistProjects(projects.map(p => (
      p.id === projectId ? { ...p, tasks: p.tasks.filter(t => t.id !== taskId) } : p
    )));
  }

  // ---------- subtasks (layer 1) ----------
  function addSubtask(projectId, taskId, text) {
    if (!text.trim()) return;
    persistProjects(projects.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        tasks: p.tasks.map(t => (
          t.id === taskId
            ? { ...t, subtasks: [...(t.subtasks || []), { id: uid(), text: text.trim(), state: 'Not Scheduled', priority: 'No Priority', dueDate: '', notes: '', subtasks: [] }] }
            : t
        )),
      };
    }));
  }

  function updateSubtask(projectId, taskId, subtaskId, patch) {
    persistProjects(projects.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        tasks: p.tasks.map(t => (
          t.id === taskId
            ? { ...t, subtasks: (t.subtasks || []).map(s => (s.id === subtaskId ? { ...s, ...patch } : s)) }
            : t
        )),
      };
    }));
    if (patch.dueDate) {
      const proj = projects.find(p => p.id === projectId);
      const t = proj && proj.tasks.find(tk => tk.id === taskId);
      const s = t && (t.subtasks || []).find(su => su.id === subtaskId);
      pushDueDateToDashboard({ title: (s && s.text) || 'Subtask', dueDate: patch.dueDate, projectTitle: (proj && proj.title) || '' });
    }
  }

  function deleteSubtask(projectId, taskId, subtaskId) {
    persistProjects(projects.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        tasks: p.tasks.map(t => (
          t.id === taskId
            ? { ...t, subtasks: (t.subtasks || []).filter(s => s.id !== subtaskId) }
            : t
        )),
      };
    }));
  }

  // ---------- sub-subtasks (layer 2) ----------
  function addSubSubtask(projectId, taskId, subtaskId, text) {
    if (!text.trim()) return;
    persistProjects(projects.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        tasks: p.tasks.map(t => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            subtasks: (t.subtasks || []).map(s => (
              s.id === subtaskId
                ? { ...s, subtasks: [...(s.subtasks || []), { id: uid(), text: text.trim(), state: 'Not Scheduled', priority: 'No Priority', dueDate: '', notes: '' }] }
                : s
            )),
          };
        }),
      };
    }));
  }

  function updateSubSubtask(projectId, taskId, subtaskId, subSubtaskId, patch) {
    persistProjects(projects.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        tasks: p.tasks.map(t => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            subtasks: (t.subtasks || []).map(s => {
              if (s.id !== subtaskId) return s;
              return {
                ...s,
                subtasks: (s.subtasks || []).map(ss => (ss.id === subSubtaskId ? { ...ss, ...patch } : ss)),
              };
            }),
          };
        }),
      };
    }));
    if (patch.dueDate) {
      const proj = projects.find(p => p.id === projectId);
      const t = proj && proj.tasks.find(tk => tk.id === taskId);
      const s = t && (t.subtasks || []).find(su => su.id === subtaskId);
      const ss = s && (s.subtasks || []).find(x => x.id === subSubtaskId);
      pushDueDateToDashboard({ title: (ss && ss.text) || 'Subtask', dueDate: patch.dueDate, projectTitle: (proj && proj.title) || '' });
    }
  }

  function deleteSubSubtask(projectId, taskId, subtaskId, subSubtaskId) {
    persistProjects(projects.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        tasks: p.tasks.map(t => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            subtasks: (t.subtasks || []).map(s => (
              s.id !== subtaskId ? s : { ...s, subtasks: (s.subtasks || []).filter(ss => ss.id !== subSubtaskId) }
            )),
          };
        }),
      };
    }));
  }

  // ---------- brainstorm notes ----------
  function addNote() {
    const idx = Math.floor(Math.random() * NOTE_PALETTE.length);
    const newNote = { id: uid(), text: '', colorIdx: idx, createdAt: Date.now() };
    persistNotes([newNote, ...notes]);
  }

  function updateNoteText(id, text) {
    setNotes(prev => prev.map(n => (n.id === id ? { ...n, text } : n)));
  }

  function commitNote(id, text) {
    persistNotes(notes.map(n => (n.id === id ? { ...n, text } : n)));
  }

  function deleteNote(id) {
    persistNotes(notes.filter(n => n.id !== id));
  }

  function promoteNote(note) {
    if (!note.text.trim()) return;
    const newProj = {
      id: uid(),
      title: note.text.trim().slice(0, 60),
      description: note.text.trim(),
      status: 'Backlog',
      priority: 'Medium',
      dueDate: '',
      tasks: [],
      createdAt: Date.now(),
    };
    persistProjects([newProj, ...projects]);
    persistNotes(notes.filter(n => n.id !== note.id));
    setTab('projects');
  }

  function handleReset() {
    if (!resetArmed) {
      setResetArmed(true);
      setTimeout(() => setResetArmed(false), 3000);
      return;
    }
    persistProjects([]);
    persistNotes([]);
    setResetArmed(false);
  }

  const filteredProjects = projects.filter(p => (
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.description.toLowerCase().includes(search.toLowerCase())
  ));

  const stats = {
    total: projects.length,
    inProgress: projects.filter(p => p.status === 'In Progress').length,
    overdue: projects.filter(p => {
      const d = formatDue(p.dueDate);
      return d && d.overdue && p.status !== 'Done';
    }).length,
    done: projects.filter(p => p.status === 'Done').length,
  };

  const activeProject = projects.find(p => p.id === activeProjectId);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: COLORS.paper }}>
        <div className="text-sm tracking-wide" style={{ color: COLORS.inkSoft, fontFamily: "'IBM Plex Mono', monospace" }}>
          Loading your board…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: COLORS.paper, color: COLORS.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .wb-display { font-family: 'Space Grotesk', sans-serif; }
        .wb-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
        .wb-scrollbar::-webkit-scrollbar { height: 8px; width: 8px; }
        .wb-scrollbar::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
        .wb-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .wb-edit-input { background: transparent; border: none; outline: none; width: 100%; min-width: 0; }
        .wb-edit-input:hover { box-shadow: 0 1px 0 ${COLORS.border}; }
        .wb-edit-input:focus { box-shadow: 0 1px 0 ${COLORS.pine}; }
      `}</style>

      <header className="border-b" style={{ borderColor: COLORS.border }}>
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="wb-mono text-xs uppercase tracking-widest mb-1" style={{ color: COLORS.pine }}>
              Project Control
            </div>
            <h1 className="wb-display text-2xl sm:text-3xl font-semibold">Work Board</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: COLORS.border }}>
              <button
                onClick={() => setTab('projects')}
                className="px-4 py-2 text-sm font-medium flex items-center gap-2"
                style={tab === 'projects' ? { backgroundColor: COLORS.pine, color: '#fff' } : { backgroundColor: COLORS.card, color: COLORS.ink }}
              >
                <LayoutGrid size={16} /> Projects
              </button>
              <button
                onClick={() => setTab('brainstorm')}
                className="px-4 py-2 text-sm font-medium flex items-center gap-2"
                style={tab === 'brainstorm' ? { backgroundColor: COLORS.pine, color: '#fff' } : { backgroundColor: COLORS.card, color: COLORS.ink }}
              >
                <Pin size={16} /> Brainstorm
              </button>
            </div>
            <button
              onClick={handleReset}
              title="Clear all data"
              className="px-2.5 py-2 rounded-lg border text-xs wb-mono flex items-center gap-1.5"
              style={{ borderColor: resetArmed ? COLORS.rose : COLORS.border, color: resetArmed ? COLORS.rose : COLORS.inkSoft, backgroundColor: COLORS.card }}
            >
              <RotateCcw size={14} /> {resetArmed ? 'Confirm?' : ''}
            </button>
          </div>
        </div>
        {storageError && (
          <div className="wb-mono text-xs text-center py-1.5" style={{ backgroundColor: COLORS.roseLight, color: COLORS.rose }}>
            Changes aren't saving right now — your board may not persist between sessions.
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {tab === 'projects' ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <StatCard label="Total" value={stats.total} color={COLORS.ink} />
              <StatCard label="In Progress" value={stats.inProgress} color={COLORS.amber} />
              <StatCard label="Overdue" value={stats.overdue} color={COLORS.rose} />
              <StatCard label="Done" value={stats.done} color={COLORS.pine} />
            </div>

            <ProjectOverviewDashboard projects={filteredProjects} />

            <div className="flex flex-wrap items-center gap-3 mb-6">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: COLORS.inkSoft }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search projects…"
                  className="w-full pl-9 pr-3 py-2 rounded-lg border text-sm outline-none"
                  style={{ borderColor: COLORS.border, backgroundColor: COLORS.card }}
                />
              </div>
              <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: COLORS.border }}>
                <button
                  onClick={() => setBoardView('board')}
                  title="Board view"
                  className="px-3 py-2 text-sm font-medium flex items-center gap-2"
                  style={boardView === 'board' ? { backgroundColor: COLORS.ink, color: '#fff' } : { backgroundColor: COLORS.card, color: COLORS.inkSoft }}
                >
                  <LayoutGrid size={15} />
                </button>
                <button
                  onClick={() => setBoardView('list')}
                  title="List view"
                  className="px-3 py-2 text-sm font-medium flex items-center gap-2"
                  style={boardView === 'list' ? { backgroundColor: COLORS.ink, color: '#fff' } : { backgroundColor: COLORS.card, color: COLORS.inkSoft }}
                >
                  <ListIcon size={15} />
                </button>
              </div>
              <button
                onClick={() => setShowNewProject(true)}
                className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
                style={{ backgroundColor: COLORS.pine, color: '#fff' }}
              >
                <Plus size={16} /> New Project
              </button>
            </div>

            {projects.length === 0 ? (
              <EmptyState
                title="No projects yet"
                body="Add your first project to start tracking the work."
                actionLabel="New Project"
                onAction={() => setShowNewProject(true)}
              />
            ) : boardView === 'board' ? (
              <div className="flex gap-4 overflow-x-auto wb-scrollbar pb-4">
                {STATUSES.map(status => (
                  <Column
                    key={status}
                    status={status}
                    projects={filteredProjects.filter(p => p.status === status)}
                    onDragStartCard={setDragId}
                    onDropColumn={() => {
                      if (dragId) { updateProject(dragId, { status }); setDragId(null); }
                      setDragOverStatus(null);
                    }}
                    onDragOverColumn={() => setDragOverStatus(status)}
                    onDragLeaveColumn={() => setDragOverStatus(null)}
                    isDragOver={dragOverStatus === status}
                    onOpen={setActiveProjectId}
                    onStatusChange={(id, s) => updateProject(id, { status: s })}
                    onDelete={deleteProject}
                  />
                ))}
              </div>
            ) : (
              <ProjectListView
                projects={filteredProjects}
                onOpen={setActiveProjectId}
                onUpdateTask={updateTask}
                onUpdateSubtask={updateSubtask}
                onUpdateSubSubtask={updateSubSubtask}
              />
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <p className="text-sm" style={{ color: COLORS.inkSoft }}>
                {notes.length} idea{notes.length === 1 ? '' : 's'} pinned. Promote any note into a project when it's ready.
              </p>
              <button
                onClick={addNote}
                className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
                style={{ backgroundColor: COLORS.pine, color: '#fff' }}
              >
                <Plus size={16} /> Pin a Note
              </button>
            </div>

            {notes.length === 0 ? (
              <EmptyState
                title="Corkboard's empty"
                body="Pin your first idea — it doesn't have to be polished."
                actionLabel="Pin a Note"
                onAction={addNote}
              />
            ) : (
              <div
                className="rounded-2xl p-6 sm:p-8"
                style={{
                  backgroundColor: COLORS.paperDark,
                  backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.08) 1px, transparent 1px)',
                  backgroundSize: '18px 18px',
                }}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                  {notes.map(note => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      palette={NOTE_PALETTE[note.colorIdx] || NOTE_PALETTE[0]}
                      rotation={rotationFor(note.id)}
                      onChange={text => updateNoteText(note.id, text)}
                      onBlur={text => commitNote(note.id, text)}
                      onDelete={() => deleteNote(note.id)}
                      onPromote={() => promoteNote(note)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {showNewProject && (
        <NewProjectModal onClose={() => setShowNewProject(false)} onSubmit={addProject} />
      )}

      {activeProject && (
        <ProjectDetail
          project={activeProject}
          onClose={() => setActiveProjectId(null)}
          onUpdate={patch => updateProject(activeProject.id, patch)}
          onDelete={() => deleteProject(activeProject.id)}
          onAddTask={text => addTask(activeProject.id, text)}
          onDeleteTask={taskId => deleteTask(activeProject.id, taskId)}
          onUpdateTask={(taskId, patch) => updateTask(activeProject.id, taskId, patch)}
          onAddSubtask={(taskId, text) => addSubtask(activeProject.id, taskId, text)}
          onUpdateSubtask={(taskId, subId, patch) => updateSubtask(activeProject.id, taskId, subId, patch)}
          onDeleteSubtask={(taskId, subId) => deleteSubtask(activeProject.id, taskId, subId)}
          onAddSubSubtask={(taskId, subId, text) => addSubSubtask(activeProject.id, taskId, subId, text)}
          onUpdateSubSubtask={(taskId, subId, ssId, patch) => updateSubSubtask(activeProject.id, taskId, subId, ssId, patch)}
          onDeleteSubSubtask={(taskId, subId, ssId) => deleteSubSubtask(activeProject.id, taskId, subId, ssId)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="rounded-lg border px-4 py-3" style={{ borderColor: COLORS.border, backgroundColor: COLORS.card }}>
      <div className="wb-mono text-xs uppercase tracking-wide mb-1" style={{ color: COLORS.inkSoft }}>{label}</div>
      <div className="wb-display text-2xl font-semibold" style={{ color }}>{value}</div>
    </div>
  );
}

// Item 6: top-of-page dashboard — every project, a completion bar, and a
// days-until-due urgency bar.
function ProjectOverviewDashboard({ projects }) {
  if (projects.length === 0) return null;
  return (
    <div className="rounded-xl border mb-6 overflow-hidden" style={{ borderColor: COLORS.border, backgroundColor: COLORS.card }}>
      <div className="px-4 py-2.5 border-b" style={{ borderColor: COLORS.border }}>
        <span className="wb-mono text-xs uppercase tracking-widest" style={{ color: COLORS.pine }}>Project Overview</span>
      </div>
      <div>
        {projects.map((p, idx) => {
          const { done, total } = countProgress(p.tasks);
          const pct = total ? Math.round((done / total) * 100) : 0;
          const due = formatDue(p.dueDate);
          let urgencyPct = 0;
          let urgencyColor = COLORS.border;
          let urgencyLabel = 'No due date';
          if (due) {
            urgencyPct = Math.max(6, Math.min(100, ((30 - due.diffDays) / 30) * 100));
            if (due.overdue) { urgencyColor = COLORS.rose; urgencyLabel = `Overdue ${Math.abs(due.diffDays)}d`; }
            else if (due.diffDays <= 7) { urgencyColor = COLORS.amber; urgencyLabel = `${due.diffDays}d left`; }
            else { urgencyColor = COLORS.sky; urgencyLabel = `${due.diffDays}d left`; }
          }
          return (
            <div
              key={p.id}
              className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 px-4 py-3"
              style={idx > 0 ? { borderTop: `1px solid ${COLORS.border}` } : undefined}
            >
              <span className="text-sm font-medium sm:w-48 sm:shrink-0 truncate" style={{ color: COLORS.ink }}>{p.title}</span>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="wb-mono text-[10px] uppercase shrink-0" style={{ color: COLORS.inkSoft, width: 62 }}>Complete</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden min-w-[60px]" style={{ backgroundColor: COLORS.border }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: COLORS.pine }} />
                </div>
                <span className="wb-mono text-[10px] shrink-0 w-8 text-right" style={{ color: COLORS.inkSoft }}>{pct}%</span>
              </div>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="wb-mono text-[10px] uppercase shrink-0" style={{ color: COLORS.inkSoft, width: 62 }}>Due</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden min-w-[60px]" style={{ backgroundColor: COLORS.border }}>
                  <div className="h-full rounded-full" style={{ width: `${urgencyPct}%`, backgroundColor: urgencyColor }} />
                </div>
                <span className="wb-mono text-[10px] shrink-0 text-right" style={{ color: urgencyColor, width: 68 }}>{urgencyLabel}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ title, body, actionLabel, onAction }) {
  return (
    <div className="rounded-2xl border border-dashed py-16 px-6 text-center" style={{ borderColor: COLORS.border }}>
      <p className="wb-display text-lg font-semibold mb-1">{title}</p>
      <p className="text-sm mb-5" style={{ color: COLORS.inkSoft }}>{body}</p>
      {actionLabel && (
        <button
          onClick={onAction}
          className="px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2"
          style={{ backgroundColor: COLORS.pine, color: '#fff' }}
        >
          <Plus size={16} /> {actionLabel}
        </button>
      )}
    </div>
  );
}

function Column({ status, projects, onDragStartCard, onDropColumn, onDragOverColumn, onDragLeaveColumn, isDragOver, onOpen, onStatusChange, onDelete }) {
  return (
    <div
      className="flex-shrink-0 rounded-xl"
      style={{ width: 280, minWidth: 280, backgroundColor: isDragOver ? COLORS.pineLight : 'transparent' }}
      onDragOver={e => { e.preventDefault(); onDragOverColumn(); }}
      onDragLeave={onDragLeaveColumn}
      onDrop={e => { e.preventDefault(); onDropColumn(); }}
    >
      <div className="flex items-center justify-between px-2 py-2 mb-2">
        <span className="wb-mono text-xs uppercase tracking-wide font-medium" style={{ color: COLORS.inkSoft }}>{status}</span>
        <span
          className="wb-mono text-xs px-2 py-0.5 rounded-full"
          style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}`, color: COLORS.inkSoft }}
        >{projects.length}</span>
      </div>
      <div className="flex flex-col gap-3 px-1" style={{ minHeight: 60 }}>
        {projects.map(p => (
          <ProjectCard
            key={p.id}
            project={p}
            onDragStart={() => onDragStartCard(p.id)}
            onOpen={() => onOpen(p.id)}
            onStatusChange={s => onStatusChange(p.id, s)}
            onDelete={() => onDelete(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectCard({ project, onDragStart, onOpen, onStatusChange, onDelete }) {
  const pc = priorityColor(project.priority);
  const due = formatDue(project.dueDate);
  const { done: doneCount, total: totalCount } = countProgress(project.tasks);
  const overdue = due && due.overdue && project.status !== 'Done';

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="group rounded-lg border shadow-sm cursor-pointer transition-transform hover:-translate-y-0.5"
      style={{ backgroundColor: COLORS.card, borderColor: COLORS.border }}
    >
      <div className="px-3 pt-3 pb-2" onClick={onOpen}>
        <div className="flex items-center justify-between mb-2">
          <span className="wb-mono text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: pc.bg, color: pc.fg }}>
            {project.priority}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: COLORS.inkSoft }}
          >
            <Trash2 size={14} />
          </button>
        </div>
        <p className="text-sm font-semibold leading-snug mb-1" style={{ color: COLORS.ink }}>{project.title}</p>
        {project.description && (
          <p className="text-xs mb-2" style={{ color: COLORS.inkSoft, ...clamp2 }}>{project.description}</p>
        )}
        {totalCount > 0 && (
          <div className="mb-2">
            <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: COLORS.border }}>
              <div className="h-full rounded-full" style={{ width: `${(doneCount / totalCount) * 100}%`, backgroundColor: COLORS.pine }} />
            </div>
            <div className="wb-mono text-xs mt-1" style={{ color: COLORS.inkSoft }}>{doneCount}/{totalCount} items · {Math.round((doneCount / totalCount) * 100)}%</div>
          </div>
        )}
        {due && (
          <div className="flex items-center gap-1 wb-mono text-xs" style={{ color: overdue ? COLORS.rose : COLORS.inkSoft }}>
            <Calendar size={11} /> {due.label}{overdue ? ' · overdue' : ''}
          </div>
        )}
      </div>
      <div className="px-3 pb-2 pt-1 border-t" style={{ borderColor: COLORS.border }} onClick={e => e.stopPropagation()}>
        <select
          value={project.status}
          onChange={e => onStatusChange(e.target.value)}
          className="wb-mono text-xs w-full bg-transparent outline-none py-1"
          style={{ color: COLORS.inkSoft }}
        >
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </div>
  );
}

// Item 1: alternative list view — project name + a toggle that expands the
// full tasks → subtasks → sub-subtasks tree inline.
function ProjectListView({ projects, onOpen, onUpdateTask, onUpdateSubtask, onUpdateSubSubtask }) {
  const [expandedIds, setExpandedIds] = useState({});
  function toggleExpand(id) { setExpandedIds(e => ({ ...e, [id]: !e[id] })); }

  if (projects.length === 0) {
    return <p className="text-sm py-8 text-center" style={{ color: COLORS.inkSoft }}>No projects match your search.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {projects.map(p => {
        const { done, total } = countProgress(p.tasks);
        const pct = total ? Math.round((done / total) * 100) : 0;
        const due = formatDue(p.dueDate);
        const overdue = due && due.overdue && p.status !== 'Done';
        const expanded = !!expandedIds[p.id];
        return (
          <div key={p.id} className="rounded-lg border" style={{ borderColor: COLORS.border, backgroundColor: COLORS.card }}>
            <div className="flex items-center gap-3 px-3 py-2.5">
              <button onClick={() => toggleExpand(p.id)} style={{ color: COLORS.inkSoft }}>
                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              <button className="text-sm font-semibold flex-1 text-left truncate" style={{ color: COLORS.ink }} onClick={() => onOpen(p.id)}>
                {p.title}
              </button>
              {total > 0 && (
                <>
                  <span className="wb-mono text-xs shrink-0" style={{ color: COLORS.inkSoft }}>{done}/{total} · {pct}%</span>
                  <div className="w-20 h-1.5 rounded-full overflow-hidden hidden sm:block shrink-0" style={{ backgroundColor: COLORS.border }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: COLORS.pine }} />
                  </div>
                </>
              )}
              {due && (
                <span className="wb-mono text-xs shrink-0" style={{ color: overdue ? COLORS.rose : COLORS.inkSoft }}>{due.label}</span>
              )}
            </div>
            {expanded && (
              <div className="px-3 pb-3 pt-1 border-t flex flex-col gap-0.5" style={{ borderColor: COLORS.border }}>
                {p.tasks.length === 0 ? (
                  <p className="text-xs py-2" style={{ color: COLORS.inkSoft }}>No tasks yet — open the project to add some.</p>
                ) : p.tasks.map(t => (
                  <TreeRow
                    key={t.id}
                    item={t}
                    depth={0}
                    hasChildren={(t.subtasks || []).length > 0}
                    onToggle={() => onUpdateTask(p.id, t.id, { state: toggledState(t) })}
                    onEditText={text => onUpdateTask(p.id, t.id, { text })}
                    onEditState={s => onUpdateTask(p.id, t.id, { state: s })}
                    onEditPriority={pr => onUpdateTask(p.id, t.id, { priority: pr })}
                    onEditDueDate={date => onUpdateTask(p.id, t.id, { dueDate: date })}
                  >
                    {(t.subtasks || []).map(s => (
                      <TreeRow
                        key={s.id}
                        item={s}
                        depth={1}
                        hasChildren={(s.subtasks || []).length > 0}
                        onToggle={() => onUpdateSubtask(p.id, t.id, s.id, { state: toggledState(s) })}
                        onEditText={text => onUpdateSubtask(p.id, t.id, s.id, { text })}
                        onEditState={st => onUpdateSubtask(p.id, t.id, s.id, { state: st })}
                        onEditPriority={pr => onUpdateSubtask(p.id, t.id, s.id, { priority: pr })}
                        onEditDueDate={date => onUpdateSubtask(p.id, t.id, s.id, { dueDate: date })}
                      >
                        {(s.subtasks || []).map(ss => (
                          <TreeRow
                            key={ss.id}
                            item={ss}
                            depth={2}
                            hasChildren={false}
                            onToggle={() => onUpdateSubSubtask(p.id, t.id, s.id, ss.id, { state: toggledState(ss) })}
                            onEditText={text => onUpdateSubSubtask(p.id, t.id, s.id, ss.id, { text })}
                            onEditState={st => onUpdateSubSubtask(p.id, t.id, s.id, ss.id, { state: st })}
                            onEditPriority={pr => onUpdateSubSubtask(p.id, t.id, s.id, ss.id, { priority: pr })}
                            onEditDueDate={date => onUpdateSubSubtask(p.id, t.id, s.id, ss.id, { dueDate: date })}
                          />
                        ))}
                      </TreeRow>
                    ))}
                  </TreeRow>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// A row in list view. Self-manages its own expand/collapse for whatever
// children are passed to it (subtasks under a task, sub-subtasks under a
// subtask), and — separately from that toggle — always exposes an editable
// due date, priority, and status for itself.
function TreeRow({ item, depth, onToggle, onEditText, onEditState, onEditPriority, onEditDueDate, hasChildren, children }) {
  const [childrenOpen, setChildrenOpen] = useState(true);
  const state = getItemState(item);
  const priority = getItemPriority(item);
  const due = formatDue(item.dueDate);
  const overdue = due && due.overdue && state !== 'Done';
  return (
    <div>
      <div className="flex items-center gap-2 py-1 flex-wrap" style={{ paddingLeft: depth * 20 }}>
        <button onClick={onToggle}>
          {state === 'Done'
            ? <CheckCircle2 size={13} style={{ color: COLORS.pine }} />
            : <Circle size={13} style={{ color: COLORS.inkSoft }} />}
        </button>
        <EditableText
          value={item.text}
          onCommit={onEditText}
          className="text-xs flex-1 min-w-[80px]"
          style={{ color: state === 'Done' ? COLORS.inkSoft : COLORS.ink, textDecoration: state === 'Done' ? 'line-through' : 'none' }}
        />
        <input
          type="date"
          value={item.dueDate || ''}
          onChange={e => onEditDueDate(e.target.value)}
          title="Due date"
          className="wb-mono text-[10px] rounded px-1 py-0.5 border outline-none shrink-0"
          style={{ borderColor: COLORS.border, color: overdue ? COLORS.rose : COLORS.inkSoft, width: 108 }}
        />
        <PrioritySelect value={priority} onChange={onEditPriority} />
        <StateSelect value={state} onChange={onEditState} />
        {hasChildren && (
          <button
            onClick={() => setChildrenOpen(o => !o)}
            title="Toggle subtasks"
            style={{ color: COLORS.inkSoft }}
          >
            {childrenOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>
      {hasChildren && childrenOpen && children}
    </div>
  );
}

function NewProjectModal({ onClose, onSubmit }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [status, setStatus] = useState('Backlog');
  const [dueDate, setDueDate] = useState('');

  function submit() {
    if (!title.trim()) return;
    onSubmit({ title, description, priority, status, dueDate });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(35,36,32,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-xl p-6" style={{ backgroundColor: COLORS.card }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="wb-display text-lg font-semibold">New Project</h2>
          <button onClick={onClose}><X size={18} style={{ color: COLORS.inkSoft }} /></button>
        </div>

        <label className="wb-mono text-xs uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>Title</label>
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="What's the project called?"
          className="w-full mt-1 mb-3 px-3 py-2 rounded-lg border text-sm outline-none"
          style={{ borderColor: COLORS.border }}
        />

        <label className="wb-mono text-xs uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="A sentence or two of context"
          rows={3}
          className="w-full mt-1 mb-3 px-3 py-2 rounded-lg border text-sm outline-none resize-none"
          style={{ borderColor: COLORS.border }}
        />

        <label className="wb-mono text-xs uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>Priority</label>
        <div className="flex gap-1 mt-1 mb-3">
          {PRIORITIES.map(p => (
            <button
              key={p}
              onClick={() => setPriority(p)}
              className="flex-1 py-1.5 rounded-lg text-xs wb-mono border"
              style={priority === p
                ? { backgroundColor: priorityColor(p).fg, color: '#fff', borderColor: priorityColor(p).fg }
                : { borderColor: COLORS.border, color: COLORS.inkSoft }}
            >{p}</button>
          ))}
        </div>

        <div className="flex gap-3 mb-5">
          <div className="flex-1">
            <label className="wb-mono text-xs uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>Status</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ borderColor: COLORS.border }}
            >
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="wb-mono text-xs uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>Due date</label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ borderColor: COLORS.border }}
            />
          </div>
        </div>

        <button
          onClick={submit}
          disabled={!title.trim()}
          className="w-full py-2.5 rounded-lg text-sm font-medium"
          style={{ backgroundColor: title.trim() ? COLORS.pine : COLORS.border, color: '#fff' }}
        >
          Add Project
        </button>
      </div>
    </div>
  );
}

function ProjectDetail({
  project, onClose, onUpdate, onDelete,
  onAddTask, onDeleteTask, onUpdateTask,
  onAddSubtask, onUpdateSubtask, onDeleteSubtask,
  onAddSubSubtask, onUpdateSubSubtask, onDeleteSubSubtask,
}) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description);
  const [taskText, setTaskText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const due = formatDue(project.dueDate);
  const overdue = due && due.overdue && project.status !== 'Done';
  const { done: progDone, total: progTotal } = countProgress(project.tasks);
  const progPct = progTotal ? Math.round((progDone / progTotal) * 100) : 0;

  useEffect(() => {
    setTitle(project.title);
    setDescription(project.description);
  }, [project.id]);

  function submitTask() {
    if (!taskText.trim()) return;
    onAddTask(taskText);
    setTaskText('');
  }

  function handleClose() {
    onUpdate({ title, description });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(35,36,32,0.5)' }} onClick={handleClose}>
      <div
        className="w-full max-w-lg rounded-xl p-6 overflow-y-auto wb-scrollbar"
        style={{ backgroundColor: COLORS.card, maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => onUpdate({ title })}
            className="wb-display text-xl font-semibold bg-transparent outline-none flex-1 mr-3"
          />
          <button onClick={handleClose}><X size={18} style={{ color: COLORS.inkSoft }} /></button>
        </div>

        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          onBlur={() => onUpdate({ description })}
          placeholder="Add a description…"
          rows={3}
          className="w-full mb-4 px-3 py-2 rounded-lg border text-sm outline-none resize-none"
          style={{ borderColor: COLORS.border }}
        />

        <label className="wb-mono text-xs uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>Priority</label>
        <div className="flex gap-1 mt-1 mb-4">
          {PRIORITIES.map(p => (
            <button
              key={p}
              onClick={() => onUpdate({ priority: p })}
              className="flex-1 py-1.5 rounded-lg text-xs wb-mono border"
              style={project.priority === p
                ? { backgroundColor: priorityColor(p).fg, color: '#fff', borderColor: priorityColor(p).fg }
                : { borderColor: COLORS.border, color: COLORS.inkSoft }}
            >{p}</button>
          ))}
        </div>

        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <label className="wb-mono text-xs uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>Status</label>
            <select
              value={project.status}
              onChange={e => onUpdate({ status: e.target.value })}
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ borderColor: COLORS.border }}
            >
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="wb-mono text-xs uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>Due date</label>
            <input
              type="date"
              value={project.dueDate}
              onChange={e => onUpdate({ dueDate: e.target.value })}
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ borderColor: COLORS.border }}
            />
          </div>
        </div>

        {due && (
          <div className="wb-mono text-xs mb-2" style={{ color: overdue ? COLORS.rose : COLORS.inkSoft }}>
            {overdue
              ? `Overdue by ${Math.abs(due.diffDays)} day${Math.abs(due.diffDays) === 1 ? '' : 's'}`
              : `Due ${due.label}`}
          </div>
        )}

        {progTotal > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="wb-mono text-xs uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>Completion</span>
              <span className="wb-mono text-xs" style={{ color: COLORS.inkSoft }}>{progDone}/{progTotal} · {progPct}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: COLORS.border }}>
              <div className="h-full rounded-full" style={{ width: `${progPct}%`, backgroundColor: COLORS.pine }} />
            </div>
          </div>
        )}

        <div className="mb-5">
          <label className="wb-mono text-xs uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>Tasks</label>
          <div className="flex flex-col gap-2 mt-2">
            {project.tasks.map(t => (
              <TaskItem
                key={t.id}
                task={t}
                onDelete={() => onDeleteTask(t.id)}
                onUpdate={patch => onUpdateTask(t.id, patch)}
                onAddSubtask={text => onAddSubtask(t.id, text)}
                onUpdateSubtask={(subId, patch) => onUpdateSubtask(t.id, subId, patch)}
                onDeleteSubtask={subId => onDeleteSubtask(t.id, subId)}
                onAddSubSubtask={(subId, text) => onAddSubSubtask(t.id, subId, text)}
                onUpdateSubSubtask={(subId, ssId, patch) => onUpdateSubSubtask(t.id, subId, ssId, patch)}
                onDeleteSubSubtask={(subId, ssId) => onDeleteSubSubtask(t.id, subId, ssId)}
              />
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <input
              value={taskText}
              onChange={e => setTaskText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitTask(); }}
              placeholder="Add a task…"
              className="flex-1 px-3 py-1.5 rounded-lg border text-sm outline-none"
              style={{ borderColor: COLORS.border }}
            />
            <button onClick={submitTask} className="px-3 rounded-lg" style={{ backgroundColor: COLORS.pine, color: '#fff' }}>
              <Plus size={16} />
            </button>
          </div>
        </div>

        <button
          onClick={() => {
            if (confirmDelete) { onDelete(); }
            else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }
          }}
          className="w-full py-2 rounded-lg text-sm wb-mono border flex items-center justify-center gap-2"
          style={{ borderColor: confirmDelete ? COLORS.rose : COLORS.border, color: confirmDelete ? COLORS.rose : COLORS.inkSoft }}
        >
          <Trash2 size={14} /> {confirmDelete ? 'Click again to delete' : 'Delete project'}
        </button>
      </div>
    </div>
  );
}

// Inline-editable text — looks like plain text until clicked, commits on
// blur or Enter. Used for task/subtask/sub-subtask names everywhere.
function EditableText({ value, onCommit, className, style, placeholder }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);

  return (
    <input
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={() => { const trimmed = text.trim(); if (trimmed && trimmed !== value) onCommit(trimmed); else setText(value); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(value); e.currentTarget.blur(); } }}
      onClick={e => e.stopPropagation()}
      placeholder={placeholder}
      className={`wb-edit-input ${className || ''}`}
      style={style}
    />
  );
}

function StateSelect({ value, onChange }) {
  const sc = stateColor(value);
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      className="wb-mono text-[10px] rounded px-1.5 py-1 outline-none border-0"
      style={{ backgroundColor: sc.bg, color: sc.fg }}
    >
      {TASK_STATES.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

function PrioritySelect({ value, onChange }) {
  const pc = taskPriorityColor(value);
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      className="wb-mono text-[10px] rounded px-1.5 py-1 outline-none border-0"
      style={{ backgroundColor: pc.bg, color: pc.fg }}
    >
      {TASK_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
    </select>
  );
}

function TaskItem({
  task, onDelete, onUpdate,
  onAddSubtask, onUpdateSubtask, onDeleteSubtask,
  onAddSubSubtask, onUpdateSubSubtask, onDeleteSubSubtask,
}) {
  const [expanded, setExpanded] = useState(false);
  const [subtaskText, setSubtaskText] = useState('');
  const [notes, setNotes] = useState(task.notes || '');
  const subtasks = task.subtasks || [];
  const state = getItemState(task);
  const priority = getItemPriority(task);
  const due = formatDue(task.dueDate);
  const overdue = due && due.overdue && state !== 'Done';

  // count of subtasks + sub-subtasks under this task (not the task itself)
  let childTotal = 0, childDone = 0;
  subtasks.forEach(s => {
    childTotal += 1; if (isItemDone(s)) childDone += 1;
    (s.subtasks || []).forEach(ss => { childTotal += 1; if (isItemDone(ss)) childDone += 1; });
  });

  useEffect(() => { setNotes(task.notes || ''); }, [task.id]);

  function toggle() {
    onUpdate({ state: toggledState(task) });
  }

  function submitSubtask() {
    if (!subtaskText.trim()) return;
    onAddSubtask(subtaskText);
    setSubtaskText('');
  }

  return (
    <div className="rounded-lg border" style={{ borderColor: COLORS.border }}>
      <div className="flex items-center gap-2 px-2 py-2 group flex-wrap">
        <button onClick={toggle}>
          {state === 'Done'
            ? <CheckCircle2 size={16} style={{ color: COLORS.pine }} />
            : <Circle size={16} style={{ color: COLORS.inkSoft }} />}
        </button>
        <EditableText
          value={task.text}
          onCommit={text => onUpdate({ text })}
          className="text-sm flex-1 min-w-[100px]"
          style={{ color: state === 'Done' ? COLORS.inkSoft : COLORS.ink, textDecoration: state === 'Done' ? 'line-through' : 'none' }}
        />
        <input
          type="date"
          value={task.dueDate || ''}
          onChange={e => onUpdate({ dueDate: e.target.value })}
          title="Due date"
          className="wb-mono text-[10px] rounded px-1 py-0.5 border outline-none"
          style={{ borderColor: COLORS.border, color: overdue ? COLORS.rose : COLORS.inkSoft, width: 108 }}
        />
        <PrioritySelect value={priority} onChange={p => onUpdate({ priority: p })} />
        <StateSelect value={state} onChange={s => onUpdate({ state: s })} />
        <button
          onClick={() => setExpanded(e => !e)}
          title="Toggle subtasks"
          className="flex items-center gap-1 wb-mono text-[10px] uppercase tracking-wide px-1.5 py-1 rounded"
          style={{ color: COLORS.inkSoft, backgroundColor: expanded ? COLORS.paperDark : 'transparent' }}
        >
          Subtasks{childTotal > 0 ? ` (${childDone}/${childTotal})` : ''} {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        <button onClick={onDelete} className="opacity-0 group-hover:opacity-100">
          <X size={14} style={{ color: COLORS.inkSoft }} />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-2 border-t" style={{ borderColor: COLORS.border }}>
          <div className="mb-3">
            <label className="wb-mono text-xs uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={() => onUpdate({ notes })}
              placeholder="Any context or details…"
              rows={2}
              className="w-full mt-1 px-2 py-1.5 rounded-lg border text-sm outline-none resize-none"
              style={{ borderColor: COLORS.border }}
            />
          </div>

          <div>
            <label className="wb-mono text-xs uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>Subtasks</label>
            <div className="flex flex-col gap-1.5 mt-2">
              {subtasks.map(s => (
                <SubtaskRow
                  key={s.id}
                  subtask={s}
                  onUpdate={patch => onUpdateSubtask(s.id, patch)}
                  onDelete={() => onDeleteSubtask(s.id)}
                  onAddSubSubtask={text => onAddSubSubtask(s.id, text)}
                  onUpdateSubSubtask={(ssId, patch) => onUpdateSubSubtask(s.id, ssId, patch)}
                  onDeleteSubSubtask={ssId => onDeleteSubSubtask(s.id, ssId)}
                />
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                value={subtaskText}
                onChange={e => setSubtaskText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitSubtask(); }}
                placeholder="Add a subtask…"
                className="flex-1 px-2 py-1.5 rounded-lg border text-xs outline-none"
                style={{ borderColor: COLORS.border }}
              />
              <button onClick={submitSubtask} className="px-2.5 rounded-lg" style={{ backgroundColor: COLORS.pine, color: '#fff' }}>
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Subtask (layer 1): its own due date, status, and an expandable list of
// sub-subtasks (layer 2).
function SubtaskRow({ subtask, onUpdate, onDelete, onAddSubSubtask, onUpdateSubSubtask, onDeleteSubSubtask }) {
  const [expanded, setExpanded] = useState(false);
  const [subSubText, setSubSubText] = useState('');
  const [notes, setNotes] = useState(subtask.notes || '');
  const state = getItemState(subtask);
  const priority = getItemPriority(subtask);
  const due = formatDue(subtask.dueDate);
  const overdue = due && due.overdue && state !== 'Done';
  const subsubtasks = subtask.subtasks || [];
  const ssDone = subsubtasks.filter(isItemDone).length;

  useEffect(() => { setNotes(subtask.notes || ''); }, [subtask.id]);

  function toggle() {
    onUpdate({ state: toggledState(subtask) });
  }

  function submitSubSub() {
    if (!subSubText.trim()) return;
    onAddSubSubtask(subSubText);
    setSubSubText('');
  }

  return (
    <div className="rounded-md border" style={{ borderColor: COLORS.border }}>
      <div className="flex items-center gap-2 px-2 py-1.5 flex-wrap">
        <button onClick={toggle}>
          {state === 'Done'
            ? <CheckCircle2 size={14} style={{ color: COLORS.pine }} />
            : <Circle size={14} style={{ color: COLORS.inkSoft }} />}
        </button>
        <EditableText
          value={subtask.text}
          onCommit={text => onUpdate({ text })}
          className="text-xs flex-1 min-w-[80px]"
          style={{ color: state === 'Done' ? COLORS.inkSoft : COLORS.ink, textDecoration: state === 'Done' ? 'line-through' : 'none' }}
        />
        {subsubtasks.length > 0 && (
          <span className="wb-mono text-[10px]" style={{ color: COLORS.inkSoft }}>{ssDone}/{subsubtasks.length}</span>
        )}
        <input
          type="date"
          value={subtask.dueDate || ''}
          onChange={e => onUpdate({ dueDate: e.target.value })}
          className="wb-mono text-[10px] rounded px-1 py-0.5 border outline-none"
          style={{ borderColor: COLORS.border, color: overdue ? COLORS.rose : COLORS.inkSoft, width: 108 }}
        />
        <PrioritySelect value={priority} onChange={p => onUpdate({ priority: p })} />
        <StateSelect value={state} onChange={s => onUpdate({ state: s })} />
        <button onClick={() => setExpanded(e => !e)} title="Notes & sub-subtasks" style={{ color: COLORS.inkSoft }}>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        <button onClick={onDelete}><X size={12} style={{ color: COLORS.inkSoft }} /></button>
      </div>

      {expanded && (
        <div className="px-2 pb-2 pt-1 border-t flex flex-col gap-1.5" style={{ borderColor: COLORS.border }}>
          <div>
            <label className="wb-mono text-[10px] uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={() => onUpdate({ notes })}
              placeholder="Any context or details…"
              rows={2}
              className="w-full mt-1 px-2 py-1 rounded-md border text-xs outline-none resize-none"
              style={{ borderColor: COLORS.border }}
            />
          </div>

          {subsubtasks.map(ss => (
            <SubSubtaskRow
              key={ss.id}
              subsubtask={ss}
              onUpdate={patch => onUpdateSubSubtask(ss.id, patch)}
              onDelete={() => onDeleteSubSubtask(ss.id)}
            />
          ))}

          <div className="flex gap-2 pl-4 mt-0.5">
            <input
              value={subSubText}
              onChange={e => setSubSubText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitSubSub(); }}
              placeholder="Add a sub-subtask…"
              className="flex-1 px-2 py-1 rounded-md border text-[11px] outline-none"
              style={{ borderColor: COLORS.border }}
            />
            <button onClick={submitSubSub} className="px-2 rounded-md" style={{ backgroundColor: COLORS.pine, color: '#fff' }}>
              <Plus size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-subtask (layer 2, the bottom of the tree). Its own due date, priority,
// status — and now its own notes, tucked behind a small expand toggle since
// there's nothing else to nest below it.
function SubSubtaskRow({ subsubtask, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(subsubtask.notes || '');
  const state = getItemState(subsubtask);
  const priority = getItemPriority(subsubtask);
  const due = formatDue(subsubtask.dueDate);
  const overdue = due && due.overdue && state !== 'Done';

  useEffect(() => { setNotes(subsubtask.notes || ''); }, [subsubtask.id]);

  function toggle() {
    onUpdate({ state: toggledState(subsubtask) });
  }

  return (
    <div>
      <div className="flex items-center gap-2 pl-4 flex-wrap">
        <button onClick={toggle}>
          {state === 'Done'
            ? <CheckCircle2 size={12} style={{ color: COLORS.pine }} />
            : <Circle size={12} style={{ color: COLORS.inkSoft }} />}
        </button>
        <EditableText
          value={subsubtask.text}
          onCommit={text => onUpdate({ text })}
          className="text-[11px] flex-1 min-w-[70px]"
          style={{ color: state === 'Done' ? COLORS.inkSoft : COLORS.ink, textDecoration: state === 'Done' ? 'line-through' : 'none' }}
        />
        <input
          type="date"
          value={subsubtask.dueDate || ''}
          onChange={e => onUpdate({ dueDate: e.target.value })}
          className="wb-mono text-[10px] rounded px-1 py-0.5 border outline-none"
          style={{ borderColor: COLORS.border, color: overdue ? COLORS.rose : COLORS.inkSoft, width: 100 }}
        />
        <PrioritySelect value={priority} onChange={p => onUpdate({ priority: p })} />
        <StateSelect value={state} onChange={s => onUpdate({ state: s })} />
        <button onClick={() => setExpanded(e => !e)} title="Notes" style={{ color: COLORS.inkSoft }}>
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
        <button onClick={onDelete}><X size={11} style={{ color: COLORS.inkSoft }} /></button>
      </div>
      {expanded && (
        <div className="pl-9 pr-1 pt-1 pb-1">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => onUpdate({ notes })}
            placeholder="Any context or details…"
            rows={2}
            className="w-full px-2 py-1 rounded-md border text-[11px] outline-none resize-none"
            style={{ borderColor: COLORS.border }}
          />
        </div>
      )}
    </div>
  );
}


function NoteCard({ note, palette, rotation, onChange, onBlur, onDelete, onPromote }) {
  const textareaRef = useRef(null);

  function autoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  useEffect(() => { autoGrow(textareaRef.current); }, []);

  return (
    <div
      className="relative rounded-md p-4 pt-6 shadow-md transition-transform hover:scale-105 hover:z-10"
      style={{ backgroundColor: palette.bg, color: palette.text, transform: `rotate(${rotation}deg)` }}
    >
      <div className="absolute left-1/2 -top-2 -translate-x-1/2 w-3 h-3 rounded-full shadow" style={{ backgroundColor: palette.pin }} />
      <textarea
        ref={textareaRef}
        value={note.text}
        onChange={e => { onChange(e.target.value); autoGrow(e.target); }}
        onBlur={e => onBlur(e.target.value)}
        placeholder="Type an idea…"
        rows={3}
        className="w-full bg-transparent outline-none resize-none text-sm leading-snug mb-3"
        style={{ color: palette.text }}
      />
      <div className="flex items-center justify-between">
        <span className="wb-mono text-xs opacity-60">
          {new Date(note.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={onPromote} title="Promote to project" className="opacity-70 hover:opacity-100">
            <ArrowRight size={14} />
          </button>
          <button onClick={onDelete} title="Remove note" className="opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
