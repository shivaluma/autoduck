import { Season3RulesGuide } from '@/components/season3-rules-guide'
import type { RouteMeta } from '@/src/pages/root-layout'
import { SEASON3_RULES_META } from '@/src/season3/season3-rules-content'

export const meta: RouteMeta = {
  title: `${SEASON3_RULES_META.title} — ĐUA DZỊT S3`,
  description: SEASON3_RULES_META.subtitle,
}

export default function Season3RulesPage() {
  return <Season3RulesGuide />
}
