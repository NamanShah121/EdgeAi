// @ts-nocheck
import { useEffect, useRef, useState } from 'react'
import { Activity, BatteryCharging, Bot, Boxes, Clock3, Cpu, Network, Pause, Play, RefreshCcw, ShieldCheck, TriangleAlert, Zap } from 'lucide-react'
import { initialRobots, points, storageRacks } from './data'
import type { Log, Metrics, Point, Robot, Task } from './types'

type Engine = { robots: Robot[]; tasks: Task[]; logs: Log[]; metrics: Metrics; number: number; obstacle: boolean; decision: string }
type View = Omit<Engine, 'number'>
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const clock = () => new Date().toLocaleTimeString([], { hour12: false })
const makeEngine = (): Engine => ({ robots: initialRobots(), tasks: [], logs: [], metrics: { picked: 0, packed: 0, dispatched: 0, reroutes: 0, prevented: 0, energy: 0 }, number: 0, obstacle: false, decision: 'Local decision-making active' })
const snapshot = (engine: Engine): View => ({ robots: engine.robots.map(robot => ({ ...robot, position: { ...robot.position }, route: [...robot.route] })), tasks: engine.tasks.map(task => ({ ...task })), logs: [...engine.logs], metrics: { ...engine.metrics }, obstacle: engine.obstacle, decision: engine.decision })
const event = (engine: Engine, type: Log['type'], message: string) => { engine.logs = [{ time: clock(), type, message }, ...engine.logs].slice(0, 5) }
const sideStep = (from: Point, to: Point, side: number): Point => { const length = Math.max(dist(from, to), 1); return { x: Math.max(5, Math.min(95, from.x - (to.y - from.y) / length * 9 * side)), y: Math.max(6, Math.min(92, from.y + (to.x - from.x) / length * 9 * side)) } }

function giveTask(engine: Engine, robot: Robot) {
  engine.number += 1
  const source = storageRacks[(engine.number * 2 + Number(robot.id.slice(1))) % storageRacks.length]
  const task: Task = { id: `TASK-${String(engine.number).padStart(3, '0')}`, robotId: robot.id, source, destination: 'Dispatch', item: `Box-${100 + engine.number}`, priority: 'NORMAL', status: 'IN PROGRESS', createdAt: Date.now(), startedAt: Date.now(), phase: 0 }
  engine.tasks = [...engine.tasks.filter(item => item.status === 'IN PROGRESS').slice(-4), task]
  robot.taskId = task.id; robot.status = 'MOVING'; robot.route = [points[source], points.Packing, points.Dispatch]; robot.routeIndex = 0
  event(engine, 'EDGE AI', `${task.id} → ${robot.id}: local route selected`)
}
function fillTasks(engine: Engine, amount: number) { engine.robots.filter(robot => robot.status === 'IDLE').slice(0, amount).forEach(robot => giveTask(engine, robot)) }
function stopReached(engine: Engine, robot: Robot, target: Point) {
  const task = engine.tasks.find(item => item.id === robot.taskId)
  if (!task) { if (robot.charging) { robot.status = 'CHARGING'; event(engine, 'INFO', `${robot.id} connected to charging dock`) } return }
  const expected = task.phase === 0 ? points[task.source] : task.phase === 1 ? points.Packing : points.Dispatch
  if (dist(target, expected) > .1) return
  task.phase += 1
  if (task.phase === 1) { robot.items = 1; robot.status = 'TRANSPORTING'; event(engine, 'SUCCESS', `${robot.id} picked ${task.item}`) }
  if (task.phase === 2) event(engine, 'SUCCESS', `${robot.id} reached packing`)
  if (task.phase === 3) { task.status = 'COMPLETED'; task.completedAt = Date.now(); robot.items = 0; robot.completed += 1; robot.taskId = undefined; robot.status = 'IDLE'; robot.route = []; robot.routeIndex = 0; event(engine, 'SUCCESS', `${task.id} completed at dispatch`) }
}
function avoidCollision(engine: Engine, timestamp: number) {
  const movers = engine.robots.filter(robot => ['MOVING', 'TRANSPORTING', 'REROUTING'].includes(robot.status) && robot.route.length)
  for (let index = 0; index < movers.length; index += 1) for (let next = index + 1; next < movers.length; next += 1) {
    const first = movers[index], second = movers[next], separation = dist(first.position, second.position)
    const sameTarget = dist(first.route[first.routeIndex], second.route[second.routeIndex]) < 2
    if (separation < 7 || (sameTarget && separation < 16)) { const yielding = first.id > second.id ? first : second; const other = yielding === first ? second : first; yielding.status = 'WAITING'; yielding.waiting = timestamp + 550; yielding.holdTarget = yielding.route[yielding.routeIndex]; engine.metrics.prevented += 1; engine.metrics.reroutes += 1; engine.decision = `${yielding.id} yielded to ${other.id}: local side-step route selected`; event(engine, 'SAFETY', `${yielding.id} ↔ ${other.id}: collision prevented`); return }
  }
}
function move(engine: Engine, elapsed: number, timestamp: number) {
  engine.robots.forEach(robot => {
    if (robot.status === 'CHARGING') { robot.battery = Math.min(100, robot.battery + elapsed * 10); if (robot.battery > 82) { robot.status = 'IDLE'; robot.charging = false; event(engine, 'SUCCESS', `${robot.id} fully charged`) } return }
    if (robot.status === 'WAITING') { if (timestamp >= robot.waiting) { const target = robot.holdTarget || points.Packing; robot.route.splice(robot.routeIndex, 0, sideStep(robot.position, target, robot.id === 'R2' || robot.id === 'R4' ? -1 : 1)); robot.holdTarget = undefined; robot.status = 'REROUTING'; event(engine, 'EDGE AI', `${robot.id} taking an open-floor side route`) } return }
    if (!robot.route.length) return
    const target = robot.route[robot.routeIndex], gap = dist(robot.position, target), step = elapsed * 9
    if (gap <= step) { robot.position = { ...target }; robot.routeIndex += 1; stopReached(engine, robot, target); if (robot.routeIndex >= robot.route.length && robot.taskId) { robot.route = []; robot.routeIndex = 0 } return }
    robot.position = { x: robot.position.x + (target.x - robot.position.x) / gap * step, y: robot.position.y + (target.y - robot.position.y) / gap * step }; robot.distance += step; robot.battery = Math.max(5, robot.battery - elapsed * .3)
  })
  avoidCollision(engine, timestamp)
}

export default function AppNew() {
  const engine = useRef<Engine>(makeEngine()), loop = useRef<number | null>(null)
  const [running, setRunning] = useState(false), [view, setView] = useState<View>(() => snapshot(engine.current)), [selected, setSelected] = useState('R1')
  const refresh = () => setView(snapshot(engine.current))
  const start = (demo = false) => { fillTasks(engine.current, demo ? 5 : 3); engine.current.decision = demo ? 'Demo active: five local edge nodes coordinating' : 'Local inference assigned available AMRs'; event(engine.current, 'INFO', demo ? 'Demo started · fleet coordination active' : 'Simulation started'); setRunning(true); refresh() }
  const reset = () => { setRunning(false); engine.current = makeEngine(); setSelected('R1'); refresh() }
  const obstacle = () => { const robot = engine.current.robots.find(item => item.route.length); engine.current.obstacle = true; if (robot) { robot.status = 'WAITING'; robot.waiting = performance.now() + 450; robot.holdTarget = robot.route[robot.routeIndex]; engine.current.metrics.reroutes += 1; engine.current.decision = `${robot.id} detected obstacle: open-floor re-route selected`; event(engine.current, 'WARNING', `Obstacle detected · ${robot.id} re-routing`) } else event(engine.current, 'WARNING', 'Obstacle placed on factory floor'); refresh() }
  const traffic = () => { if (!running) start(true); const robot = engine.current.robots.filter(item => item.route.length).at(-1); if (robot) { robot.status = 'WAITING'; robot.waiting = performance.now() + 520; robot.holdTarget = robot.route[robot.routeIndex]; engine.current.metrics.prevented += 1; engine.current.metrics.reroutes += 1; engine.current.decision = `${robot.id} received local traffic signal and will side-step`; event(engine.current, 'SAFETY', 'High traffic mode: robot coordination active') } refresh() }
  const battery = () => { const robot = engine.current.robots.find(item => item.status === 'IDLE') || engine.current.robots[4]; robot.battery = 18; robot.charging = true; robot.taskId = undefined; robot.route = [points.Charging]; robot.routeIndex = 0; robot.status = 'MOVING'; engine.current.decision = `${robot.id} battery low: charging dock reserved locally`; event(engine.current, 'WARNING', `${robot.id} battery 18% → charging`); setRunning(true); refresh() }
  useEffect(() => { if (!running) return; let last = performance.now(), lastPaint = last; const frame = (time: number) => { move(engine.current, Math.min(.06, (time - last) / 1000), time); last = time; if (time - lastPaint > 90) { lastPaint = time; setView(snapshot(engine.current)) } loop.current = requestAnimationFrame(frame) }; loop.current = requestAnimationFrame(frame); return () => { if (loop.current !== null) cancelAnimationFrame(loop.current); loop.current = null } }, [running])
  const active = view.tasks.filter(task => task.status === 'IN PROGRESS').length, done = view.tasks.filter(task => task.status === 'COMPLETED').length, average = done ? Math.round(view.tasks.filter(task => task.completedAt && task.startedAt).reduce((sum, task) => sum + (task.completedAt! - task.startedAt!) / 1000, 0) / done) : 0, robot = view.robots.find(item => item.id === selected) || view.robots[0]
  return <main className="prototype"><header className="compact-header"><div className="brand"><div className="brand-mark"><Bot size={20}/></div><div><h1>SMART WAREHOUSE</h1><p>Edge-AI AMR Fleet Coordination</p></div></div><div className="header-status"><span className="online"><i/> SYSTEM ONLINE</span><span><Cpu size={14}/> EDGE AI ACTIVE</span><span><Network size={14}/> 5 AMRs ONLINE</span></div></header><section className="compact-kpis">{[['ACTIVE TASKS', active, Activity], ['COMPLETED', done, Boxes], ['ROBOTS ONLINE', '5/5', Bot], ['PREVENTED', view.metrics.prevented, ShieldCheck], ['RE-ROUTES', view.metrics.reroutes, RefreshCcw], ['AVG TASK TIME', `${average}s`, Clock3]].map(([label, value, Icon]) => { const MetricIcon = Icon as typeof Activity; return <article key={String(label)}><MetricIcon size={15}/><span>{label}</span><b>{value}</b></article> })}</section><section className="compact-main"><div className="map-card"><div className="map-heading"><div><span>LIVE DIGITAL TWIN</span><h2>Warehouse Operations Map</h2></div><small>{running ? '● SIMULATION RUNNING' : '○ READY TO START'}</small></div><Map robots={view.robots} selected={selected} onSelect={setSelected} obstacle={view.obstacle}/></div><aside className="compact-side"><Decision decision={view.decision}/><NetworkPanel/><RobotPanel robot={robot}/></aside></section><section className="compact-bottom"><Controls running={running} start={()=>start()} pause={()=>setRunning(false)} reset={reset} obstacle={obstacle} traffic={traffic} battery={battery} demo={()=>start(true)}/><TaskQueue tasks={view.tasks}/><ActivityStream logs={view.logs}/></section></main>
}

function Map({ robots, selected, onSelect, obstacle }: { robots: Robot[]; selected: string; onSelect: (id: string) => void; obstacle: boolean }) { return <div className="warehouse compact-map"><div className="zone pickup"><b>PICKUP / STORAGE</b><Boxes size={18}/></div><div className="zone packing"><b>PACKING</b></div><div className="zone dispatch"><b>DISPATCH / LOADING</b></div><div className="zone charging"><BatteryCharging size={15}/><b>CHARGING</b></div><div className="racks">{storageRacks.map(rack => <div className="rack" key={rack}><span>{rack}</span><i/><i/><i/></div>)}</div>{obstacle && <div className="floor-obstacle"><TriangleAlert size={17}/><b>OBSTACLE</b></div>}<svg className="routes" viewBox="0 0 100 100" preserveAspectRatio="none">{robots.filter(robot => robot.route.length).map(robot => <polyline key={robot.id} points={[robot.position, ...robot.route.slice(robot.routeIndex)].map(point => `${point.x},${point.y}`).join(' ')} stroke={robot.color}/>)}</svg>{robots.map(robot => <button key={robot.id} className={`robot ${selected === robot.id ? 'active' : ''} ${robot.status.toLowerCase()}`} style={{ left: `${robot.position.x}%`, top: `${robot.position.y}%`, '--robot': robot.color } as React.CSSProperties} onClick={() => onSelect(robot.id)}><span className="arrow">▲</span><b>{robot.id}</b><i/></button>)}</div> }
function Decision({ decision }: { decision: string }) { return <div className="panel mini-panel decision"><h3><Cpu size={16}/> Edge AI Decision</h3><p>{decision}</p><ul><li>✓ Local inference</li><li>✓ Robot coordination</li><li>✓ Dynamic re-routing</li></ul></div> }
function NetworkPanel() { return <div className="panel mini-panel network"><h3><Network size={16}/> Robot Network</h3><strong>5/5 ROBOTS ONLINE</strong><p><i/> LOCAL COMMUNICATION ACTIVE</p></div> }
function RobotPanel({ robot }: { robot: Robot }) { return <div className="panel mini-panel robot-summary"><h3><Bot size={16}/> {robot.id} Status</h3><div><b>{robot.status}</b><span>{robot.taskId || 'AVAILABLE'}</span></div><p>BATTERY <b>{Math.round(robot.battery)}%</b></p><em><i style={{ width: `${robot.battery}%` }}/></em></div> }
function Controls({ running, start, pause, reset, obstacle, traffic, battery, demo }: { running: boolean; start: () => void; pause: () => void; reset: () => void; obstacle: () => void; traffic: () => void; battery: () => void; demo: () => void }) { return <div className="panel controls compact-controls"><h3><Zap size={16}/> Simulation Controls</h3><div><button className="primary" onClick={start}><Play size={14}/> Start</button><button onClick={pause}><Pause size={14}/> Pause</button><button onClick={reset}><RefreshCcw size={14}/> Reset</button><button onClick={obstacle}><TriangleAlert size={14}/> Obstacle</button><button onClick={traffic}><Activity size={14}/> High Traffic</button><button onClick={battery}><BatteryCharging size={14}/> Low Battery</button><button className="demo" onClick={demo}><Zap size={14}/> {running ? 'Restart Demo' : 'Start Demo'}</button></div></div> }
function TaskQueue({ tasks }: { tasks: Task[] }) { return <div className="panel mini-list"><h3><Boxes size={16}/> Task Queue</h3>{tasks.length ? tasks.slice(-4).reverse().map(task => <p key={task.id}><b>{task.id}</b><span>{task.robotId || '—'}</span><span>{task.source} → Dispatch</span><i>{task.status}</i></p>) : <small>Start the simulation to assign tasks.</small>}</div> }
function ActivityStream({ logs }: { logs: Log[] }) { return <div className="panel mini-list"><h3><Activity size={16}/> Activity Stream</h3>{logs.length ? logs.map((item, index) => <p key={`${item.time}-${index}`}><time>{item.time}</time><i className={item.type.toLowerCase().replace(' ', '-')}>{item.type}</i><span>{item.message}</span></p>) : <small>Local telemetry ready.</small>}</div> }
