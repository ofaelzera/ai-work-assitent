import dynamic from 'next/dynamic'

const GoogleCallbackHandler = dynamic(() => import('./GoogleCallbackHandler'), { ssr: false })

export default function GoogleCallbackPage() {
  return <GoogleCallbackHandler />
}
