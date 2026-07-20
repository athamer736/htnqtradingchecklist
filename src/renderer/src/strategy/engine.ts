import {
  ENTRY_GUIDANCE,
  SMT_PATH,
  TERMINAL_TIMEFRAME,
  TIMEFRAME_ORDER,
  TPD_PATH,
  type SmtPathRule,
  type Timeframe,
  type TpdPathRule
} from './strategy'

export type NodeKind = 'FVG' | 'SMT' | 'TPD' | 'RL'
// Which confluence head a node descends from. Purely structural - both are
// equivalent (no reversal/continuation meaning).
export type Branch = 'root' | 'smt' | 'tpd'

export interface TreeNode {
  id: string
  kind: NodeKind
  timeframe: Timeframe
  label: string
  branch: Branch
  /** RL nodes that represent a tradable entry (highlighted gray, like the charts). */
  isEntry: boolean
  /** Short description of what this node is / what to do. */
  note: string
  /** Optional extra note (e.g. the M5 special case). */
  extra?: string
  children: TreeNode[]
}

function rlLabel(tf: Timeframe): string {
  return `${tf} RL`
}

// Builds the SMT confluence chain: SMT -> TPD -> RL(entry, recursed).
// If the rule has no tpd/mmxm, the SMT is terminal (the branch ends there).
function buildSmtPath(rule: SmtPathRule, pathId: string): TreeNode {
  if (!rule.tpd || !rule.mmxm) {
    return {
      id: `${pathId}.smt`,
      kind: 'SMT',
      timeframe: rule.smt,
      label: `${rule.smt} SMT`,
      branch: 'smt',
      isEntry: false,
      note: `Look for an SMT divergence on the ${rule.smt}. This is the final confluence - the sequence ends here.`,
      children: []
    }
  }

  const rl = buildRl(rule.mmxm, `${pathId}.rl`, 'smt')

  const tpd: TreeNode = {
    id: `${pathId}.tpd`,
    kind: 'TPD',
    timeframe: rule.tpd,
    label: `${rule.tpd} TPD`,
    branch: 'smt',
    isEntry: false,
    note: `Resolves the ${rule.smt} SMT and forms the ${rule.mmxm} MMXM.`,
    children: [rl]
  }

  const smt: TreeNode = {
    id: `${pathId}.smt`,
    kind: 'SMT',
    timeframe: rule.smt,
    label: `${rule.smt} SMT`,
    branch: 'smt',
    isEntry: false,
    note: `Look for an SMT divergence on the ${rule.smt}. It resolves into a ${rule.tpd} TPD.`,
    children: [tpd]
  }

  return smt
}

// Builds the TPD confluence chain: TPD -> RL(entry, recursed).
function buildTpdPath(rule: TpdPathRule, pathId: string): TreeNode {
  const rl = buildRl(rule.mmxm, `${pathId}.rl`, 'tpd')

  const tpd: TreeNode = {
    id: `${pathId}.tpd`,
    kind: 'TPD',
    timeframe: rule.tpd,
    label: `${rule.tpd} TPD`,
    branch: 'tpd',
    isEntry: false,
    note: `Look for a ${rule.tpd} TPD; it forms the ${rule.mmxm} MMXM.`,
    children: [rl]
  }

  // An M1 TPD sits at the terminal timeframe, so it is itself tradable.
  if (rule.tpd === TERMINAL_TIMEFRAME) {
    tpd.extra = 'You can also use this as your entry.'
  }

  return tpd
}

// Adds both confluence options to an FVG/RL node (if rules exist + not terminal).
function attachBranches(node: TreeNode, pathId: string): void {
  if (node.timeframe === TERMINAL_TIMEFRAME) return

  const smtRule = SMT_PATH[node.timeframe]
  if (smtRule) {
    node.children.push(buildSmtPath(smtRule, `${pathId}.s`))
  }

  const tpdRule = TPD_PATH[node.timeframe]
  if (tpdRule) {
    node.children.push(buildTpdPath(tpdRule, `${pathId}.t`))
  }
}

function buildRl(tf: Timeframe, pathId: string, branch: Branch): TreeNode {
  const node: TreeNode = {
    id: pathId,
    kind: 'RL',
    timeframe: tf,
    label: rlLabel(tf),
    branch,
    isEntry: true,
    note: ENTRY_GUIDANCE,
    children: []
  }
  if (tf === 'M5') {
    node.extra = 'M5 can be taken as an M5 TPD, or as an RL entry if there is a TPD above it.'
  }
  attachBranches(node, pathId)
  return node
}

/** Build the full ideal-setup tree from a starting FVG timeframe. */
export function buildTree(startTf: Timeframe): TreeNode {
  const root: TreeNode = {
    id: 'root',
    kind: 'FVG',
    timeframe: startTf,
    label: `${startTf} FVG`,
    branch: 'root',
    isEntry: false,
    note: `Starting setup: a ${startTf} FVG / RL. Confirm it with an SMT or a TPD.`,
    children: []
  }
  attachBranches(root, 'root')
  return root
}

/** Depth-first walk yielding every node. */
export function walk(
  node: TreeNode,
  fn: (n: TreeNode, parent: TreeNode | null) => void,
  parent: TreeNode | null = null
): void {
  fn(node, parent)
  for (const child of node.children) walk(child, fn, node)
}

/** Find a node by id. */
export function findNode(root: TreeNode, id: string): TreeNode | null {
  let found: TreeNode | null = null
  walk(root, (n) => {
    if (n.id === id) found = n
  })
  return found
}

/** All entry (RL) stations in top-down order, with depth for sorting. */
export interface EntryStation {
  node: TreeNode
  depth: number
}

export function collectEntries(root: TreeNode): EntryStation[] {
  const entries: EntryStation[] = []
  const recurse = (n: TreeNode, depth: number): void => {
    if (n.isEntry) entries.push({ node: n, depth })
    n.children.forEach((c) => recurse(c, depth + 1))
  }
  recurse(root, 0)
  return entries.sort((a, b) => a.depth - b.depth)
}

// -----------------------------------------------------------------------------
// Guided next-step descriptions
// -----------------------------------------------------------------------------

export interface NextStep {
  headNodeId: string
  headKind: NodeKind
  /** Labels from the immediate next node down to the next entry RL (inclusive). */
  steps: string[]
  /** The entry timeframe this branch leads to, or null if it ends without an entry. */
  entryTimeframe: Timeframe | null
}

/** For ANY node, describe the next confluence step(s) toward an entry. */
export function nextSteps(node: TreeNode): NextStep[] {
  return node.children.map((child) => {
    const steps: string[] = []
    let cursor: TreeNode | undefined = child
    let entryTf: Timeframe | null = null
    // Each branch is a linear chain (single child) until it reaches the entry RL
    // (or a terminal node with no entry, should a rule ever omit its TPD/MMXM).
    while (cursor) {
      steps.push(cursor.label)
      if (cursor.isEntry) {
        entryTf = cursor.timeframe
        break
      }
      cursor = cursor.children[0]
    }
    return {
      headNodeId: child.id,
      headKind: child.kind,
      steps,
      entryTimeframe: entryTf
    }
  })
}

// -----------------------------------------------------------------------------
// Reference tables (derived from the same data)
// -----------------------------------------------------------------------------

export interface ReferenceRow {
  fvg: string
  confirmation: string
  chain: string
  entry: string
}

export function smtPathReference(): ReferenceRow[] {
  return TIMEFRAME_ORDER.filter((tf) => SMT_PATH[tf]).map((tf) => {
    const r = SMT_PATH[tf]!
    if (!r.tpd || !r.mmxm) {
      return {
        fvg: `${tf} FVG`,
        confirmation: `${r.smt} SMT`,
        chain: `${r.smt} SMT (ends here)`,
        entry: '-'
      }
    }
    return {
      fvg: `${tf} FVG`,
      confirmation: `${r.smt} SMT`,
      chain: `${r.smt} SMT -> ${r.tpd} TPD -> ${r.mmxm} MMXM`,
      entry: `${r.mmxm} RL`
    }
  })
}

export function tpdPathReference(): ReferenceRow[] {
  return TIMEFRAME_ORDER.filter((tf) => TPD_PATH[tf]).map((tf) => {
    const c = TPD_PATH[tf]!
    return {
      fvg: `${tf} FVG`,
      confirmation: `${c.tpd} TPD`,
      chain: `${c.tpd} TPD -> ${c.mmxm} MMXM`,
      entry: `${c.mmxm} RL`
    }
  })
}
