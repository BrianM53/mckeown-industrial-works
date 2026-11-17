import { Component, Suspense, useEffect, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react'
import { recordDebugError, setModuleStatus } from '@/core/debug'
import { useGameStore } from '@/state/game'

/**
 * Isolates one world module: lazy-loaded, its own Suspense and error boundary.
 * A crash or failed import in one module never takes down the rest of the world.
 */
interface SlotProps {
  name: string
  component: LazyExoticComponent<ComponentType>
}

export function ModuleSlot({ name, component: C }: SlotProps) {
  const register = useGameStore((s) => s.registerModuleSlot)
  useEffect(() => {
    register(name)
    setModuleStatus(name, 'loading')
  }, [name, register])
  return (
    <ModuleBoundary name={name}>
      <Suspense fallback={null}>
        <LoadedMarker name={name}>
          <C />
        </LoadedMarker>
      </Suspense>
    </ModuleBoundary>
  )
}

function LoadedMarker({ name, children }: { name: string; children: ReactNode }) {
  const mark = useGameStore((s) => s.markModuleLoaded)
  useEffect(() => {
    mark(name)
    setModuleStatus(name, 'ready')
  }, [name, mark])
  return <>{children}</>
}

interface BoundaryState {
  error: Error | null
}

class ModuleBoundary extends Component<{ name: string; children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    const msg = `[module:${this.props.name}] ${error?.message ?? error}`
    console.error(msg, error)
    recordDebugError(msg)
    setModuleStatus(this.props.name, 'error')
    useGameStore.getState().markModuleLoaded(this.props.name)
  }

  render() {
    if (this.state.error) return null
    return this.props.children
  }
}
