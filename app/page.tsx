'use client'

import dynamic from 'next/dynamic'

const CrmContent = dynamic(() => import('./components/CrmContent'), { ssr: false })

export default function Home() {
  return <CrmContent />
}