import React, { useEffect, useRef, useState } from 'react'
import {
  Activity,
  Bot,
  Boxes,
  Clock3,
  Cpu,
  Network,
  PackageCheck,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  ShieldAlert,
  Truck,
  Zap
} from 'lucide-react'
import {
  initialRobots,
  storageRacks,
  planPath,
  getPickupPoint,
  getDropPoint,
  packingStations,
  dispatchBays,
  homeBays
} from './data'
import type { Log, Metrics, Point, Robot, Task } from './types'

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const formatTime = () => new Date().toLocaleTimeString([], { hour12: false })

interface EngineState {
  robots: Robot[]
  tasks: Task[]
  logs: Log[]
  metrics: Metrics
  decision: string
  taskCounter: number
  lastConflictTime: number
  demoPhase: number
  demoWaitUntil: number
}

class SimulationEngine {
  robots: Robot[]
  tasks: Task[]
  logs: Log[]
  metrics: Metrics
  decision: string
  taskCounter: number
  lastConflictTime: number
  demoPhase: number
  demoWaitUntil: number

  constructor() {
    this.robots = initialRobots()
    this.tasks = []
    this.logs = []
    this.metrics = {
      activeRobots: 0,
      activeTasks: 0,
      completed: 0,
      conflicts: 0,
      reroutes: 0
    }
    this.decision = 'Local edge agents online. Separated bays & collision envelopes armed.'
    this.taskCounter = 0
    this.lastConflictTime = 0
    this.demoPhase = 0
    this.demoWaitUntil = 0
  }

  addLog(type: Log['type'], message: string) {
    this.logs = [{ time: formatTime(), type, message }, ...this.logs].slice(0, 6)
  }

  assignTask(robotId: string, source: string, destination: string): { success: boolean; error?: string } {
    const robot = this.robots.find(r => r.id === robotId)
    if (!robot) return { success: false, error: `Robot ${robotId} not found.` }

    if (robot.taskId && robot.status !== 'IDLE') {
      const activeTask = this.tasks.find(t => t.id === robot.taskId)
      const currentTaskStatus = activeTask ? activeTask.status : robot.status
      return {
        success: false,
        error: `Robot ${robotId} is currently busy with ${robot.taskId} (${currentTaskStatus})`
      }
    }

    this.taskCounter += 1
    const taskId = `TASK-${String(this.taskCounter).padStart(3, '0')}`
    const pickupPoint = getPickupPoint(source)

    const task: Task = {
      id: taskId,
      robotId,
      source,
      destination,
      item: `Box-${100 + this.taskCounter}`,
      priority: 'NORMAL',
      status: 'ASSIGNED',
      createdAt: Date.now(),
      startedAt: Date.now()
    }

    // Keep max 4 relevant tasks
    this.tasks = [task, ...this.tasks.filter(t => t.status !== 'COMPLETED').slice(0, 3)]

    // Plan route from robot's current location to dedicated pickup point
    const route = planPath(robot.position, pickupPoint, false)
    robot.taskId = taskId
    robot.status = 'IN PROGRESS'
    robot.route = route
    robot.routeIndex = 0
    robot.items = 0
    robot.isAlternateRoute = false

    this.addLog('INFO', `${robotId} assigned to Rack ${source}`)
    this.addLog('EDGE AI', `Path planned: ${robotId} → Rack ${source}`)
    this.decision = `${robotId} assigned: Rack ${source} → ${destination}. Isolated drop station reserved.`

    this.updateMetrics()
    return { success: true }
  }

  triggerManualConflict() {
    const movers = this.robots.filter(
      r => ['IN PROGRESS', 'MOVING TO DROP', 'REROUTING'].includes(r.status) && r.route.length > 0
    )

    if (movers.length >= 2) {
      const rA = movers[0]
      const rB = movers[1]
      this.resolveConflict(rA, rB, performance.now())
      return
    }

    // If fewer than 2 robots are moving, dispatch R1 and R3 on converging paths
    const r1 = this.robots.find(r => r.id === 'R1')
    const r3 = this.robots.find(r => r.id === 'R3')
    if (r1 && r3) {
      if (!r1.taskId) this.assignTask('R1', 'R11', 'Packing')
      if (!r3.taskId) this.assignTask('R3', 'R31', 'Packing')
      this.decision = 'Conflict scenario initiated: R1 and R3 converging on Central Aisle.'
      this.addLog('WARNING', 'Simulated corridor convergence initiated')
    }
  }

  rerouteRobot(robot: Robot) {
    robot.status = 'REROUTING'
    robot.isAlternateRoute = true
    this.metrics.reroutes += 1

    const activeTask = this.tasks.find(t => t.id === robot.taskId)
    let targetPoint = robot.home
    if (activeTask) {
      if (activeTask.status === 'MOVING TO DROP') {
        targetPoint = getDropPoint(activeTask.destination, robot.id)
      } else {
        targetPoint = getPickupPoint(activeTask.source)
      }
    }

    // Direct Bypass Corridor routing at current Y to escape congestion instantly
    robot.route = [
      { x: 70, y: robot.position.y },
      { x: 70, y: targetPoint.y },
      { x: targetPoint.x, y: targetPoint.y }
    ]
    robot.routeIndex = 0

    this.decision = `Deadlock prevented: Alternate corridor engaged for ${robot.id} via Bypass Highway.`
    this.addLog('EDGE AI', 'Alternate route selected')
    this.addLog('EDGE AI', `${robot.id} rerouted via Bypass Corridor`)
  }

  resolveConflict(rA: Robot, rB: Robot, timestamp: number) {
    if (timestamp - this.lastConflictTime < 400) return
    this.lastConflictTime = timestamp
    this.metrics.conflicts += 1

    // Lower priority robot (higher ID) yields
    const yielding = rA.id > rB.id ? rA : rB
    const continuing = yielding === rA ? rB : rA

    this.addLog('SAFETY', 'Local conflict detected')

    // If other robot is stationary or yielding has already waited, reroute immediately!
    const otherStationary = continuing.status === 'IDLE' || continuing.status === 'ITEM PICKED' || continuing.status === 'WAITING' || continuing.route.length === 0
    if (otherStationary || yielding.status === 'WAITING' || !yielding.isAlternateRoute) {
      this.rerouteRobot(yielding)
    } else {
      yielding.status = 'WAITING'
      yielding.waitingUntil = timestamp + 500 // Snappy 500ms wait
      this.metrics.reroutes += 1
      this.decision = `Local conflict detected: ${yielding.id} waiting for intersection (yielding to ${continuing.id}).`
      this.addLog('EDGE AI', `${yielding.id} waiting for intersection`)
    }
  }

  checkConflicts(timestamp: number) {
    const movers = this.robots.filter(
      r => ['IN PROGRESS', 'MOVING TO DROP', 'REROUTING'].includes(r.status) && r.route.length > 0
    )

    for (let i = 0; i < movers.length; i++) {
      for (let j = i + 1; j < movers.length; j++) {
        const r1 = movers[i]
        const r2 = movers[j]
        const sep = distance(r1.position, r2.position)

        // Conflict check: only if close (< 5.8%) or head-on on highway
        const inHighway = Math.abs(r1.position.x - 56) < 3.5 && Math.abs(r2.position.x - 56) < 3.5
        const highwayCongestion = inHighway && Math.abs(r1.position.y - r2.position.y) < 10

        if (sep < 5.8 || highwayCongestion) {
          this.resolveConflict(r1, r2, timestamp)
          return
        }
      }
    }
  }

  tick(dt: number, timestamp: number, isDemoMode: boolean) {
    // 1. Update each robot
    this.robots.forEach(robot => {
      // Handle WAITING state
      if (robot.status === 'WAITING') {
        if (timestamp >= robot.waitingUntil) {
          // Check if path is now clear from any nearby robot
          const nearby = this.robots.some(o => o.id !== robot.id && distance(robot.position, o.position) < 5.8)
          if (!nearby) {
            robot.status = robot.items > 0 ? 'MOVING TO DROP' : 'IN PROGRESS'
            this.decision = `Path clear — ${robot.id} movement resumed.`
            this.addLog('EDGE AI', 'Path clear — movement resumed')
          } else {
            // Still occupied! Reroute immediately around the blockage
            this.rerouteRobot(robot)
          }
        }
        return
      }

      // If robot has no route or is IDLE, nothing to advance
      if (!robot.route.length) return

      const target = robot.route[robot.routeIndex]
      if (!target) return

      const gap = distance(robot.position, target)
      const step = dt * 26 // Fast, smooth movement

      // Critical Anti-Collision Safety Check with Priority Right-of-Way
      let canAdvance = true
      for (const other of this.robots) {
        if (other.id === robot.id) continue
        const currDist = distance(robot.position, other.position)
        const nextX = robot.position.x + ((target.x - robot.position.x) / gap) * step
        const nextY = robot.position.y + ((target.y - robot.position.y) / gap) * step
        const nextDist = distance({ x: nextX, y: nextY }, other.position)

        // Only intervene if closing in within 5.8 map units
        if (nextDist < 5.8 && nextDist < currDist) {
          // If the other robot is ALREADY waiting for us, we have right-of-way! DO NOT STOP!
          if (other.status === 'WAITING' && other.waitingUntil > timestamp) {
            continue
          }

          // If we have higher priority (lower ID), we keep moving through!
          if (robot.id < other.id) {
            this.resolveConflict(robot, other, timestamp)
            continue
          }

          // We are the lower-priority robot: we yield or reroute
          canAdvance = false
          this.resolveConflict(robot, other, timestamp)
          break
        }
      }

      if (!canAdvance) return

      if (gap <= step) {
        // Snap to target waypoint
        robot.position = { ...target }
        robot.routeIndex += 1

        // Check if finished entire route
        if (robot.routeIndex >= robot.route.length) {
          const task = this.tasks.find(t => t.id === robot.taskId)

          if (task) {
            if (task.status === 'ASSIGNED' || task.status === 'IN PROGRESS') {
              // Reached rack pickup approach!
              task.status = 'ITEM PICKED'
              robot.items = 1
              robot.status = 'ITEM PICKED'
              this.addLog('SUCCESS', `ITEM PICKED by ${robot.id}`)
              this.addLog('INFO', `${robot.id} reached Rack ${task.source}`)

              // Route from pickup to robot's DEDICATED drop bay (P1-P5 or D1-D5)
              const destPoint = getDropPoint(task.destination, robot.id)
              robot.route = planPath(robot.position, destPoint, robot.isAlternateRoute)
              robot.routeIndex = 0
              robot.status = 'MOVING TO DROP'
              task.status = 'MOVING TO DROP'
              this.decision = `${robot.id} item loaded at ${task.source} → proceeding to dedicated drop bay.`
            } else if (task.status === 'MOVING TO DROP') {
              // Reached dedicated drop station!
              task.status = 'ITEM DROPPED'
              this.addLog('SUCCESS', `ITEM DROPPED by ${robot.id}`)
              this.addLog('INFO', `${robot.id} reached ${task.destination} (Bay ${robot.id})`)

              // Mark task completed
              task.status = 'COMPLETED'
              task.completedAt = Date.now()
              this.metrics.completed += 1
              this.addLog('SUCCESS', `${task.id} completed`)

              // Free robot
              robot.status = 'IDLE'
              robot.items = 0
              robot.taskId = undefined
              robot.isAlternateRoute = false
              robot.completed += 1
              robot.route = []
              robot.routeIndex = 0
              this.decision = `${task.id} completed. ${robot.id} secure at dedicated drop bay.`
            }
          } else {
            // General route or return to staging completed
            robot.route = []
            robot.routeIndex = 0
            robot.status = 'IDLE'
          }
        }
      } else {
        // Advance smoothly towards target
        const dx = (target.x - robot.position.x) / gap
        const dy = (target.y - robot.position.y) / gap
        robot.position.x += dx * step
        robot.position.y += dy * step
        robot.distance += step
        robot.battery = Math.max(15, robot.battery - dt * 0.15)
      }
    })

    // 2. Check for local path conflicts
    this.checkConflicts(timestamp)

    // 3. Demo mode automated progression
    if (isDemoMode) {
      this.tickDemo(timestamp)
    }

    this.updateMetrics()
  }

  tickDemo(timestamp: number) {
    if (timestamp < this.demoWaitUntil) return

    // Phase 0: Dispatch R1 and R3 towards Packing (each has dedicated station P1 & P3)
    if (this.demoPhase === 0) {
      this.assignTask('R1', 'R11', 'Packing')
      this.assignTask('R3', 'R31', 'Packing')
      this.decision = 'Demo Phase 1: R1 & R3 dispatched to Packing. Dedicated stations P1 & P3 prevent drop collisions.'
      this.demoPhase = 1
      this.demoWaitUntil = timestamp + 1000
      return
    }

    // Phase 1: Wait for both to complete tasks
    if (this.demoPhase === 1) {
      const active = this.tasks.filter(t => t.status !== 'COMPLETED')
      if (active.length === 0) {
        this.demoPhase = 2
        this.demoWaitUntil = timestamp + 2500
        this.decision = 'Phase 1 complete. Preparing Phase 2: R2 & R4 to Dispatch bays D2 & D4.'
      }
      return
    }

    // Phase 2: Dispatch R2 and R4 to Dispatch bays
    if (this.demoPhase === 2) {
      this.assignTask('R2', 'R21', 'Dispatch')
      this.assignTask('R4', 'R41', 'Dispatch')
      this.decision = 'Demo Phase 2: R2 & R4 dispatched to Dispatch bays D2 & D4 with bypass routing.'
      this.demoPhase = 3
      this.demoWaitUntil = timestamp + 1000
      return
    }

    // Phase 3: Wait for phase 2 to complete, then loop back
    if (this.demoPhase === 3) {
      const active = this.tasks.filter(t => t.status !== 'COMPLETED')
      if (active.length === 0) {
        this.demoPhase = 0
        this.demoWaitUntil = timestamp + 3000
        this.decision = 'Demo cycle complete. All AMR drops isolated with 0 collisions.'
      }
    }
  }

  updateMetrics() {
    this.metrics.activeRobots = this.robots.filter(r => r.status !== 'IDLE').length
    this.metrics.activeTasks = this.tasks.filter(t => t.status !== 'COMPLETED').length
  }

  getSnapshot(): EngineState {
    return {
      robots: this.robots.map(r => ({
        ...r,
        position: { ...r.position },
        route: [...r.route]
      })),
      tasks: this.tasks.map(t => ({ ...t })),
      logs: [...this.logs],
      metrics: { ...this.metrics },
      decision: this.decision,
      taskCounter: this.taskCounter,
      lastConflictTime: this.lastConflictTime,
      demoPhase: this.demoPhase,
      demoWaitUntil: this.demoWaitUntil
    }
  }
}

export default function AppNew() {
  const engineRef = useRef<SimulationEngine>(new SimulationEngine())
  const loopRef = useRef<number | null>(null)

  const [running, setRunning] = useState(false)
  const [demoMode, setDemoMode] = useState(false)
  const [selectedRobotId, setSelectedRobotId] = useState('R1')
  const [view, setView] = useState<EngineState>(() => engineRef.current.getSnapshot())

  // Manual Task Creation inputs
  const [manualRobot, setManualRobot] = useState('R1')
  const [manualPickup, setManualPickup] = useState('R21')
  const [manualDrop, setManualDrop] = useState('Packing')
  const [busyError, setBusyError] = useState<string | null>(null)

  // Single requestAnimationFrame loop
  useEffect(() => {
    if (!running) {
      if (loopRef.current !== null) {
        cancelAnimationFrame(loopRef.current)
        loopRef.current = null
      }
      return
    }

    let lastTime = performance.now()
    let lastPaint = lastTime

    const frame = (now: number) => {
      const dt = Math.min(0.045, (now - lastTime) / 1000)
      lastTime = now

      engineRef.current.tick(dt, now, demoMode)

      // Throttle React view updates to ~30fps for high performance
      if (now - lastPaint >= 33) {
        lastPaint = now
        setView(engineRef.current.getSnapshot())
      }

      loopRef.current = requestAnimationFrame(frame)
    }

    loopRef.current = requestAnimationFrame(frame)

    return () => {
      if (loopRef.current !== null) {
        cancelAnimationFrame(loopRef.current)
        loopRef.current = null
      }
    }
  }, [running, demoMode])

  const handleStart = () => {
    setRunning(true)
  }

  const handlePause = () => {
    setRunning(false)
  }

  const handleReset = () => {
    setRunning(false)
    setDemoMode(false)
    engineRef.current = new SimulationEngine()
    setBusyError(null)
    setSelectedRobotId('R1')
    setView(engineRef.current.getSnapshot())
  }

  const handleStartDemo = () => {
    engineRef.current = new SimulationEngine()
    setBusyError(null)
    setDemoMode(true)
    setRunning(true)
    engineRef.current.addLog('INFO', 'Demo Mode active: separated drops & collision avoidance engaged')
    setView(engineRef.current.getSnapshot())
  }

  const handleCreateManualTask = (e: React.FormEvent) => {
    e.preventDefault()
    const res = engineRef.current.assignTask(manualRobot, manualPickup, manualDrop)
    if (!res.success) {
      setBusyError(res.error || `Robot ${manualRobot} is unavailable.`)
    } else {
      setBusyError(null)
      if (!running) setRunning(true)
      setView(engineRef.current.getSnapshot())
    }
  }

  const handleSimulateConflict = () => {
    engineRef.current.triggerManualConflict()
    if (!running) setRunning(true)
    setView(engineRef.current.getSnapshot())
  }

  const selectedRobot = view.robots.find(r => r.id === selectedRobotId) || view.robots[0]

  const robotBusyMap = view.robots.reduce((acc, r) => {
    acc[r.id] = r.status !== 'IDLE' && !!r.taskId
    return acc
  }, {} as Record<string, boolean>)

  return (
    <main className="prototype">
      {/* 1. Header */}
      <header className="compact-header">
        <div className="brand">
          <div className="brand-mark">
            <Bot size={20} />
          </div>
          <div>
            <h1>FLEET MESH</h1>
            <p>Edge-AI AMR Fleet Coordination · Collision-Free</p>
          </div>
        </div>

        <div className="header-status">
          <span className="online">
            <i /> SYSTEM ONLINE
          </span>
          <span>
            <Cpu size={13} /> EDGE AI: <b>ACTIVE</b>
          </span>
          <span>
            <Network size={13} /> AMR FLEET: <b>5/5 MESH</b>
          </span>
          <span className="clock">
            <Clock3 size={13} /> {formatTime()}
          </span>
        </div>
      </header>

      {/* 2. Key Metrics Bar */}
      <section className="compact-kpis">
        <article>
          <div className="kpi-top">
            <span>ACTIVE ROBOTS</span>
            <Bot size={13} className="kpi-icon" />
          </div>
          <b>{view.metrics.activeRobots} / 5</b>
        </article>
        <article>
          <div className="kpi-top">
            <span>ACTIVE TASKS</span>
            <Activity size={13} className="kpi-icon" />
          </div>
          <b>{view.metrics.activeTasks}</b>
        </article>
        <article>
          <div className="kpi-top">
            <span>COMPLETED TASKS</span>
            <PackageCheck size={13} className="kpi-icon" />
          </div>
          <b style={{ color: '#34d399' }}>{view.metrics.completed}</b>
        </article>
        <article>
          <div className="kpi-top">
            <span>CONFLICTS RESOLVED</span>
            <ShieldAlert size={13} className="kpi-icon" />
          </div>
          <b style={{ color: view.metrics.conflicts > 0 ? '#fbbf24' : '#edf7ff' }}>
            {view.metrics.conflicts}
          </b>
        </article>
        <article>
          <div className="kpi-top">
            <span>REROUTES / YIELDS</span>
            <RefreshCcw size={13} className="kpi-icon" />
          </div>
          <b style={{ color: view.metrics.reroutes > 0 ? '#38bdf8' : '#edf7ff' }}>
            {view.metrics.reroutes}
          </b>
        </article>
        <article>
          <div className="kpi-top">
            <span>SYSTEM MODE</span>
            <Zap size={13} className="kpi-icon" />
          </div>
          <b style={{ fontSize: '11px', color: demoMode ? '#fbbf24' : '#60a5fa' }}>
            {demoMode ? 'AUTO DEMO' : running ? 'LIVE RUNNING' : 'PAUSED'}
          </b>
        </article>
      </section>

      {/* 3. Main Workspace */}
      <section className="compact-main">
        {/* Map Card */}
        <div className="map-card">
          <div className="map-heading">
            <div>
              <span>LIVE DIGITAL TWIN · SEPARATED DROP & PICKUP BAYS</span>
              <h2>Warehouse Operations Map</h2>
            </div>
            <div className="map-status-pill">
              {running ? (
                <span className="pill-running">● SIMULATION RUNNING</span>
              ) : (
                <span className="pill-paused">○ PAUSED / READY</span>
              )}
            </div>
          </div>

          <WarehouseMap
            robots={view.robots}
            selectedId={selectedRobotId}
            onSelectRobot={setSelectedRobotId}
          />
        </div>

        {/* Right Rail */}
        <aside className="compact-side">
          {/* Edge AI Decision Box */}
          <div className="panel mini-panel decision">
            <h3>
              <Cpu size={15} /> Edge AI Decision
            </h3>
            <p className="decision-text">{view.decision}</p>
            <ul>
              <li>✓ Dedicated Drop & Staging Bays</li>
              <li>✓ Proximity Safety Envelope (10.5m)</li>
              <li>✓ Dynamic Corridor Yield & Reroute</li>
            </ul>
          </div>

          {/* Selected Robot Inspector */}
          <div className="panel mini-panel robot-summary">
            <div className="robot-summary-header">
              <h3>
                <Bot size={15} /> {selectedRobot.id} Inspector
              </h3>
              <div className="robot-selector-pills">
                {view.robots.map(r => (
                  <button
                    key={r.id}
                    className={`pill-btn ${selectedRobotId === r.id ? 'active' : ''}`}
                    onClick={() => setSelectedRobotId(r.id)}
                    style={{ borderColor: selectedRobotId === r.id ? r.color : undefined }}
                  >
                    {r.id}
                  </button>
                ))}
              </div>
            </div>

            <div className="robot-stats-grid">
              <div>
                <span>STATUS</span>
                <b style={{ color: selectedRobot.status === 'IDLE' ? '#94a3b8' : '#38bdf8' }}>
                  {selectedRobot.status}
                </b>
              </div>
              <div>
                <span>CURRENT TASK</span>
                <b>{selectedRobot.taskId || 'NONE (IDLE)'}</b>
              </div>
              <div>
                <span>PAYLOAD</span>
                <b>{selectedRobot.items > 0 ? '1 BOX' : '0 (EMPTY)'}</b>
              </div>
              <div>
                <span>TASKS DONE</span>
                <b>{selectedRobot.completed}</b>
              </div>
            </div>

            <div className="robot-battery-bar">
              <div className="battery-label">
                <span>BATTERY</span>
                <b>{Math.round(selectedRobot.battery)}%</b>
              </div>
              <em>
                <i
                  style={{
                    width: `${selectedRobot.battery}%`,
                    background: selectedRobot.battery < 25 ? '#fb923c' : selectedRobot.color
                  }}
                />
              </em>
            </div>
          </div>

          {/* Network Panel */}
          <div className="panel mini-panel network">
            <h3>
              <Network size={15} /> AMR Mesh Telemetry
            </h3>
            <strong>5/5 SEPARATED NODES</strong>
            <p>
              <i /> ANTI-COLLISION ENVELOPE ARMED
            </p>
          </div>
        </aside>
      </section>

      {/* 4. Bottom Row */}
      <section className="compact-bottom-three">
        {/* Panel 1: Simulation Controls & Manual Task Creation */}
        <div className="panel bottom-panel controls-panel">
          <div className="panel-title-bar">
            <h3>
              <Zap size={15} /> Control Deck
            </h3>
            <div className="control-btn-group">
              {running ? (
                <button className="btn-action" onClick={handlePause}>
                  <Pause size={13} /> Pause
                </button>
              ) : (
                <button className="btn-action primary" onClick={handleStart}>
                  <Play size={13} /> Start
                </button>
              )}
              <button className="btn-action" onClick={handleReset}>
                <RefreshCcw size={13} /> Reset
              </button>
              <button
                className={`btn-action demo-btn ${demoMode ? 'active' : ''}`}
                onClick={handleStartDemo}
              >
                <Zap size={13} /> {demoMode ? 'Restart Demo' : 'Start Demo'}
              </button>
              <button className="btn-action conflict-btn" onClick={handleSimulateConflict}>
                <ShieldAlert size={13} /> Simulate Conflict
              </button>
            </div>
          </div>

          {/* Compact Manual Task Form */}
          <form className="manual-task-form" onSubmit={handleCreateManualTask}>
            <div className="form-field">
              <label>Robot</label>
              <select
                value={manualRobot}
                onChange={e => {
                  setManualRobot(e.target.value)
                  setBusyError(null)
                }}
              >
                {['R1', 'R2', 'R3', 'R4', 'R5'].map(r => (
                  <option key={r} value={r}>
                    {r} {robotBusyMap[r] ? '●' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Pickup</label>
              <select value={manualPickup} onChange={e => setManualPickup(e.target.value)}>
                {storageRacks.map(rack => (
                  <option key={rack} value={rack}>
                    {rack}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Drop</label>
              <select value={manualDrop} onChange={e => setManualDrop(e.target.value)}>
                <option value="Packing">Packing</option>
                <option value="Dispatch">Dispatch</option>
              </select>
            </div>

            <button type="submit" className="create-task-submit">
              <Plus size={13} /> Create Task
            </button>
          </form>

          {busyError && <div className="busy-error-alert">{busyError}</div>}
        </div>

        {/* Panel 2: Live Task Queue */}
        <div className="panel bottom-panel task-queue-panel">
          <div className="panel-title-bar">
            <h3>
              <Boxes size={15} /> Task Queue
            </h3>
            <span className="queue-count">{view.tasks.length} tasks</span>
          </div>

          <div className="task-queue-list">
            {view.tasks.length ? (
              view.tasks.slice(0, 4).map(task => (
                <div className="task-queue-row" key={task.id}>
                  <b>{task.id}</b>
                  <span className="task-robot-id">{task.robotId || '—'}</span>
                  <span className="task-route-str">
                    {task.source} → {task.destination}
                  </span>
                  <span className={`task-badge ${task.status.toLowerCase().replace(/\s+/g, '-')}`}>
                    {task.status}
                  </span>
                </div>
              ))
            ) : (
              <div className="empty-message">No active tasks. Create a task or start demo.</div>
            )}
          </div>
        </div>

        {/* Panel 3: Activity Stream */}
        <div className="panel bottom-panel activity-stream-panel">
          <div className="panel-title-bar">
            <h3>
              <Activity size={15} /> Activity Stream
            </h3>
            <span className="stream-badge">LIVE EDGE LOGS</span>
          </div>

          <div className="activity-list">
            {view.logs.length ? (
              view.logs.map((log, idx) => (
                <div className="activity-row" key={`${log.time}-${idx}`}>
                  <time>{log.time}</time>
                  <span className={`log-badge ${log.type.toLowerCase().replace(/\s+/g, '-')}`}>
                    {log.type}
                  </span>
                  <span className="log-text">{log.message}</span>
                </div>
              ))
            ) : (
              <div className="empty-message">Telemetry ready. Awaiting robot dispatch.</div>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

function WarehouseMap({
  robots,
  selectedId,
  onSelectRobot
}: {
  robots: Robot[]
  selectedId: string
  onSelectRobot: (id: string) => void
}) {
  return (
    <div className="warehouse compact-map">
      {/* Zone 1: Dedicated Bays (Left) */}
      <div className="zone pickup">
        <div className="staging-slots">
          {(['R1', 'R2', 'R3', 'R4', 'R5'] as const).map((rid, idx) => {
            const bayNum = `${idx + 1}`
            const yPos = homeBays[rid].y
            const topPct = ((yPos - 6) / 82) * 100
            return (
              <div
                key={rid}
                className="staging-slot"
                style={{
                  top: `${topPct}%`,
                  left: '50%',
                  transform: 'translate(-50%, -50%)'
                }}
              >
                <span className="bay-tag">BAY {bayNum}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Zone 2: Packing Area with SEPARATED STATIONS P1–P5 */}
      <div className="zone packing">
        <b>PACKING AREA</b>
        <span>Separated Drop Stations</span>
        <PackageCheck size={17} />
        <div className="zone-bays">
          {(['R1', 'R2', 'R3', 'R4', 'R5'] as const).map(rid => {
            const p = packingStations[rid]
            return (
              <div
                key={rid}
                className="zone-station-mark"
                style={{
                  left: `${((p.x - 80) / 17) * 100}%`,
                  top: `${((p.y - 8) / 34) * 100}%`
                }}
              >
                <span>P-{rid}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Zone 3: Dispatch Area with SEPARATED BAYS D1–D5 */}
      <div className="zone dispatch">
        <b>DISPATCH BAY</b>
        <span>Separated Outbound Bays</span>
        <Truck size={17} />
        <div className="zone-bays">
          {(['R1', 'R2', 'R3', 'R4', 'R5'] as const).map(rid => {
            const p = dispatchBays[rid]
            return (
              <div
                key={rid}
                className="zone-station-mark"
                style={{
                  left: `${((p.x - 80) / 17) * 100}%`,
                  top: `${((p.y - 48) / 34) * 100}%`
                }}
              >
                <span>D-{rid}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Zone 4: AMR Charging Docks (Bottom) */}
      <div className="zone charging">
        <Zap size={14} />
        <b>CHARGING</b>
      </div>

      {/* Aisle Guides */}
      <div className="aisle-lane central-aisle" style={{ left: '56%' }}>
        <span>CENTRAL HIGHWAY (MAIN)</span>
      </div>
      <div className="aisle-lane bypass-aisle" style={{ left: '70%' }}>
        <span>BYPASS HIGHWAY (REROUTE)</span>
      </div>

      {/* Storage Racks */}
      <div className="racks">
        {storageRacks.map(rack => (
          <div className="rack" key={rack}>
            <span>{rack}</span>
            <i />
            <i />
            <i />
          </div>
        ))}
      </div>

      {/* SVG Navigation Paths / Routes */}
      <svg className="routes" viewBox="0 0 100 100" preserveAspectRatio="none">
        {robots
          .filter(r => r.route.length > 0)
          .map(r => {
            const currentRoutePoints = [r.position, ...r.route.slice(r.routeIndex)]
            return (
              <polyline
                key={r.id}
                points={currentRoutePoints.map(p => `${p.x},${p.y}`).join(' ')}
                stroke={r.color}
                strokeWidth={1.8}
                strokeDasharray={r.status === 'REROUTING' ? '3 1.5' : '4 2'}
                opacity={0.88}
              />
            )
          })}
      </svg>

      {/* AMR Robot Markers */}
      {robots.map(robot => {
        const isSelected = selectedId === robot.id
        const isWaiting = robot.status === 'WAITING'
        const isRerouting = robot.status === 'REROUTING'
        const hasItem = robot.items > 0

        return (
          <button
            key={robot.id}
            aria-label={robot.id}
            className={`robot ${isSelected ? 'active' : ''} ${robot.status.toLowerCase().replace(/\s+/g, '-')}`}
            style={
              {
                left: `${robot.position.x}%`,
                top: `${robot.position.y}%`,
                '--robot': robot.color
              } as React.CSSProperties
            }
            onClick={() => onSelectRobot(robot.id)}
          >
            <span className="arrow">▲</span>
            <b>{robot.id}</b>
            {hasItem && <span className="cargo-box">📦</span>}
            {isWaiting && <span className="wait-pill">WAIT</span>}
            {isRerouting && <span className="reroute-pill">REROUTE</span>}
            <i style={{ background: isWaiting ? '#fbbf24' : '#34d399' }} />
          </button>
        )
      })}
    </div>
  )
}
