import { useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Panel,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { walk, type TreeNode } from '../strategy/engine'
import TreeNodeCard, { type TreeCardData } from './TreeNodeCard'

const NODE_W = 134
const NODE_H = 56

const nodeTypes: NodeTypes = { card: TreeNodeCard }

// Single unified edge color (no reversal/continuation distinction).
const EDGE_COLOR = '#3b82f6'

function ZoomControls(): JSX.Element {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const btn =
    'flex items-center gap-1.5 rounded-lg border border-line bg-bg-soft/90 px-3 py-2 text-xs font-medium text-slate-300 backdrop-blur transition-all duration-150 hover:bg-bg-hover hover:text-white active:scale-95'

  return (
    <Panel position="bottom-left" className="!m-3 flex gap-2">
      <button className={btn} onClick={() => zoomIn({ duration: 200 })} title="Zoom in">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
        Zoom in
      </button>
      <button className={btn} onClick={() => zoomOut({ duration: 200 })} title="Zoom out">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 12h14" strokeLinecap="round" />
        </svg>
        Zoom out
      </button>
      <button
        className={btn}
        onClick={() => fitView({ duration: 300, padding: 0.2 })}
        title="Fit to screen"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Fit
      </button>
    </Panel>
  )
}

function layout(root: TreeNode, focusedId: string | null): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 64, marginx: 24, marginy: 24 })

  const rfNodes: Node[] = []
  const rfEdges: Edge[] = []

  walk(root, (n, parent) => {
    g.setNode(n.id, { width: NODE_W, height: NODE_H })
    if (parent) {
      g.setEdge(parent.id, n.id)
      rfEdges.push({
        id: `${parent.id}->${n.id}`,
        source: parent.id,
        target: n.id,
        type: 'smoothstep',
        animated: false,
        style: { stroke: EDGE_COLOR, strokeWidth: 1.6 },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR, width: 16, height: 16 }
      })
    }
  })

  dagre.layout(g)

  walk(root, (n) => {
    const pos = g.node(n.id)
    const data: TreeCardData = {
      label: n.label,
      kind: n.kind,
      isEntry: n.isEntry,
      focused: n.id === focusedId
    }
    rfNodes.push({
      id: n.id,
      type: 'card',
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      data,
      draggable: false,
      connectable: false,
      selectable: true
    })
  })

  return { nodes: rfNodes, edges: rfEdges }
}

export default function TreeGraph({
  root,
  focusedId,
  onNodeClick
}: {
  root: TreeNode
  focusedId: string | null
  onNodeClick: (id: string) => void
}): JSX.Element {
  const computed = useMemo(() => layout(root, focusedId), [root, focusedId])
  const [nodes, setNodes, onNodesChange] = useNodesState(computed.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(computed.edges)

  useEffect(() => {
    setNodes(computed.nodes)
    setEdges(computed.edges)
  }, [computed, setNodes, setEdges])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onNodeClick(node.id)}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.3}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      panOnScroll
      className="bg-bg"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1c212c" />
      <ZoomControls />
    </ReactFlow>
  )
}
