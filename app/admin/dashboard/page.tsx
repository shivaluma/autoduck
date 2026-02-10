import { Suspense } from 'react'
import { AdminDashboardContent } from './content'

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-900 text-white p-8">Loading Admin Dashboard...</div>}>
      <AdminDashboardContent />
    </Suspense>
  )
}
