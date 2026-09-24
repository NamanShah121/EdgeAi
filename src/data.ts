import type { Point, Robot } from './types'

export const storageRacks = ['R01', 'R02', 'R11', 'R12', 'R21', 'R22', 'R31', 'R32', 'R41', 'R42']

// Storage rack coordinates
export const rackPositions: Record<string, Point> = {
  R01: { x: 30, y: 16 },
  R02: { x: 44, y: 16 },
  R11: { x: 30, y: 32 },
  R12: { x: 44, y: 32 },
  R21: { x: 30, y: 48 },
  R22: { x: 44, y: 48 },
  R31: { x: 30, y: 64 },
  R32: { x: 44, y: 64 },
  R41: { x: 30, y: 80 },
  R42: { x: 44, y: 80 }
}

// Separated home staging bays along left zone (B1 to B5 inside AMR Staging)
export const homeBays: Record<string, Point> = {
  R1: { x: 10.5, y: 15 },
  R2: { x: 10.5, y: 30 },
  R3: { x: 10.5, y: 45 },
  R4: { x: 10.5, y: 60 },
  R5: { x: 10.5, y: 75 }
}

// Separated drop locations for Packing (dedicated station per robot)
export const packingStations: Record<string, Point> = {
  R1: { x: 84, y: 14 },
  R2: { x: 92, y: 14 },
  R3: { x: 84, y: 26 },
  R4: { x: 92, y: 26 },
  R5: { x: 88, y: 37 }
}

// Separated drop locations for Dispatch (dedicated bay per robot)
export const dispatchBays: Record<string, Point> = {
  R1: { x: 84, y: 54 },
  R2: { x: 92, y: 54 },
  R3: { x: 84, y: 66 },
  R4: { x: 92, y: 66 },
  R5: { x: 88, y: 77 }
}

// Helper to resolve dedicated pickup point alongside rack
export function getPickupPoint(source: string): Point {
  const rack = rackPositions[source] || { x: 30, y: 48 }
  // Approach Col A from left (x: 25), Col B from right (x: 49)
  const approachX = rack.x <= 35 ? 25 : 49
  return { x: approachX, y: rack.y }
}

// Helper to resolve separated drop point per robot ID
export function getDropPoint(destination: string, robotId: string): Point {
  if (destination === 'Dispatch') {
    return dispatchBays[robotId] || { x: 88, y: 66 }
  }
  // Default to Packing
  return packingStations[robotId] || { x: 88, y: 25 }
}

export const points: Record<string, Point> = {
  ...rackPositions,
  Packing: { x: 88, y: 25 },
  Dispatch: { x: 88, y: 66 },
  Charging: { x: 62, y: 90 }
}

export const initialRobots = (): Robot[] => [
  { id: 'R1', color: '#38bdf8', position: { ...homeBays.R1 }, home: { ...homeBays.R1 }, status: 'IDLE', battery: 100, route: [], routeIndex: 0, distance: 0, items: 0, completed: 0, waitingUntil: 0, charging: false },
  { id: 'R2', color: '#a78bfa', position: { ...homeBays.R2 }, home: { ...homeBays.R2 }, status: 'IDLE', battery: 100, route: [], routeIndex: 0, distance: 0, items: 0, completed: 0, waitingUntil: 0, charging: false },
  { id: 'R3', color: '#34d399', position: { ...homeBays.R3 }, home: { ...homeBays.R3 }, status: 'IDLE', battery: 100, route: [], routeIndex: 0, distance: 0, items: 0, completed: 0, waitingUntil: 0, charging: false },
  { id: 'R4', color: '#fb923c', position: { ...homeBays.R4 }, home: { ...homeBays.R4 }, status: 'IDLE', battery: 100, route: [], routeIndex: 0, distance: 0, items: 0, completed: 0, waitingUntil: 0, charging: false },
  { id: 'R5', color: '#f472b6', position: { ...homeBays.R5 }, home: { ...homeBays.R5 }, status: 'IDLE', battery: 100, route: [], routeIndex: 0, distance: 0, items: 0, completed: 0, waitingUntil: 0, charging: false }
]

// Predefined orthogonal warehouse path corridors
// Central Highway: x = 56
// Bypass Corridor: x = 70
// Staging Corridor: x = 18
export function planPath(from: Point, to: Point, bypass = false): Point[] {
  const waypoints: Point[] = []
  const highwayX = bypass ? 70 : 56

  // 1. If starting from staging bays (x <= 14)
  if (from.x <= 14) {
    waypoints.push({ x: 18, y: from.y }) // step into staging transit lane
    // Heading to rack
    if (to.x <= 50) {
      waypoints.push({ x: 18, y: to.y })
      waypoints.push({ x: to.x, y: to.y })
      return waypoints
    }
    // Heading to drop zone (x >= 75)
    waypoints.push({ x: 18, y: 10 }) // top transit cross
    waypoints.push({ x: highwayX, y: 10 })
    waypoints.push({ x: highwayX, y: to.y })
    waypoints.push({ x: to.x, y: to.y })
    return waypoints
  }

  // 2. Start is alongside rack (x: 25 or x: 49) heading to drop zone (x >= 75)
  if (from.x <= 50 && to.x >= 75) {
    waypoints.push({ x: highwayX, y: from.y })
    waypoints.push({ x: highwayX, y: to.y })
    waypoints.push({ x: to.x, y: to.y })
    return waypoints
  }

  // 3. Start is at drop station (x >= 75) returning to home staging (x <= 12)
  if (from.x >= 75 && to.x <= 12) {
    const returnY = from.y > 50 ? 88 : 8 // bottom or top return cross
    waypoints.push({ x: 74, y: from.y })
    waypoints.push({ x: 74, y: returnY })
    waypoints.push({ x: 18, y: returnY })
    waypoints.push({ x: 18, y: to.y })
    waypoints.push({ x: to.x, y: to.y })
    return waypoints
  }

  // 4. Start is drop zone (x >= 75) to rack (x <= 50)
  if (from.x >= 75 && to.x <= 50) {
    waypoints.push({ x: highwayX, y: from.y })
    waypoints.push({ x: highwayX, y: to.y })
    waypoints.push({ x: to.x, y: to.y })
    return waypoints
  }

  // General fallback: orthogonal highway routing
  if (Math.abs(from.x - highwayX) > 2) {
    waypoints.push({ x: highwayX, y: from.y })
  }
  waypoints.push({ x: highwayX, y: to.y })
  waypoints.push({ x: to.x, y: to.y })

  return waypoints
}
