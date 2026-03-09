'use client'
import dynamic from 'next/dynamic'
import { use } from 'react'
const DealPage = dynamic(() => import('../../components/DealPage'), { ssr: false })
export default function Deal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <DealPage dealId={id} />
}