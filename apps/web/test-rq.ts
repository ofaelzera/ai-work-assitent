import { QueryClient } from '@tanstack/react-query'
const qc = new QueryClient()
const q = qc.getQueryCache().find({ queryKey: ['test'] })
if (q?.isActive()) {}
