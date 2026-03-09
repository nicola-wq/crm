'use client'
import { Suspense } from 'react'
import dynamic from 'next/dynamic'
const CrmContent = dynamic(() => import('./components/CrmContent'), { ssr: false })
export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-100 flex items-center justify-center"><p className="text-gray-500">Caricamento...</p></div>}>
      <CrmContent />
    </Suspense>
  )
}