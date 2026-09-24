export type Point = { x: number; y: number }
export type RobotStatus = 'IDLE' | 'MOVING' | 'PICKING' | 'TRANSPORTING' | 'PACKING' | 'DISPATCHING' | 'CHARGING' | 'REROUTING' | 'WAITING'
export type TaskStatus = 'PENDING' | 'IN PROGRESS' | 'COMPLETED'
export type Task = { id: string; robotId?: string; source: string; destination: string; item: string; priority: 'HIGH' | 'NORMAL'; status: TaskStatus; createdAt: number; phase: number; startedAt?: number; completedAt?: number }
export type Robot = { id: string; color: string; position: Point; home: Point; status: RobotStatus; battery: number; taskId?: string; route: Point[]; routeIndex: number; distance: number; items: number; completed: number; waiting: number; charging: boolean; holdTarget?: Point }
export type Log = { time: string; type: 'INFO' | 'SUCCESS' | 'WARNING' | 'EDGE AI' | 'SAFETY'; message: string }
export type Metrics = { picked: number; packed: number; dispatched: number; reroutes: number; prevented: number; energy: number }
