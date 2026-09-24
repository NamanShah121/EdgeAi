export type Point = { x: number; y: number }

export type RobotStatus =
  | 'IDLE'
  | 'MOVING'
  | 'IN PROGRESS'
  | 'PICKING'
  | 'ITEM PICKED'
  | 'MOVING TO DROP'
  | 'ITEM DROPPED'
  | 'TRANSPORTING'
  | 'WAITING'
  | 'REROUTING'
  | 'CHARGING'

export type TaskStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'IN PROGRESS'
  | 'ITEM PICKED'
  | 'MOVING TO DROP'
  | 'ITEM DROPPED'
  | 'COMPLETED'

export type Task = {
  id: string
  robotId?: string
  source: string
  destination: string
  item: string
  priority: 'HIGH' | 'NORMAL'
  status: TaskStatus
  createdAt: number
  phase?: number
  startedAt?: number
  completedAt?: number
}

export type Robot = {
  id: string
  color: string
  position: Point
  home: Point
  status: RobotStatus
  battery: number
  taskId?: string
  route: Point[]
  routeIndex: number
  distance: number
  items: number
  completed: number
  waitingUntil: number
  charging: boolean
  holdTarget?: Point
  isAlternateRoute?: boolean
}

export type Log = {
  time: string
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'EDGE AI' | 'SAFETY'
  message: string
}

export type Metrics = {
  activeRobots: number
  activeTasks: number
  completed: number
  conflicts: number
  reroutes: number
}
