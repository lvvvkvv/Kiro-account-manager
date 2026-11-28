export interface ChainDiagnose {
  upstreamReachable: boolean
  upstreamError?: string
  upstreamRtMs?: number
  targetReachable: boolean
  targetError?: string
  targetRtMs?: number
  targetStatus?: number
  targetStatusText?: string
  targetBodySnippet?: string
  endToEndOk?: boolean
  endToEndError?: string
  endToEndRtMs?: number
}
