import { AdminDashboardContent } from './content'

interface PageProps {
  searchParams: Promise<{ secret?: string }>
}

export default async function AdminDashboardPage({ searchParams }: PageProps) {
  const params = await searchParams
  const secret = params.secret

  return <AdminDashboardContent secret={secret} />
}
