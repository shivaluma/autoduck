import type { Metadata } from 'next'
import { Season3RulesGuide } from '@/components/season3-rules-guide'
import { SEASON3_RULES_META } from '@/lib/season3-rules-content'

export const metadata: Metadata = {
  title: `${SEASON3_RULES_META.title} — ĐUA DZỊT S3`,
  description: SEASON3_RULES_META.subtitle,
}

export default function Season3RulesPage() {
  return <Season3RulesGuide />
}
