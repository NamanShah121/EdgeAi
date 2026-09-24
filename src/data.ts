import type { Point, Robot } from './types'
export const points: Record<string, Point> = {
  'Pickup / Storage': { x: 9, y: 25 }, R01: { x: 31, y: 18 }, R02: { x: 43, y: 18 }, R11: { x: 31, y: 34 }, R12: { x: 43, y: 34 }, R21: { x: 31, y: 50 }, R22: { x: 43, y: 50 }, R31: { x: 31, y: 66 }, R32: { x: 43, y: 66 }, R41: { x: 31, y: 82 }, R42: { x: 43, y: 82 }, Packing: { x: 76, y: 32 }, Dispatch: { x: 88, y: 68 }, Charging: { x: 70, y: 88 }, Edge: { x: 14, y: 88 }
}
export const initialRobots = (): Robot[] => [
  ['R1','#38bdf8',{x:13,y:78}], ['R2','#a78bfa',{x:53,y:20}], ['R3','#34d399',{x:53,y:50}], ['R4','#fb923c',{x:53,y:82}], ['R5','#f472b6',{x:88,y:45}]
].map(([id,color,home]) => ({ id: id as string, color: color as string, position: home as Point, home: home as Point, status: 'IDLE', battery: 100, route: [], routeIndex: 0, distance: 0, items: 0, completed: 0, waiting: 0, charging: false }))
export const storageRacks = ['R01','R02','R11','R12','R21','R22','R31','R32','R41','R42']
