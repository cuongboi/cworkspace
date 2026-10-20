export type WikiTemplate = {
  id: string
  label: string
  title: string
  content: string
}

/** Starting points for a new page (plain Markdown, edited like any page). */
export const WIKI_TEMPLATES: WikiTemplate[] = [
  { id: "blank", label: "Blank", title: "", content: "" },
  {
    id: "meeting",
    label: "Meeting notes",
    title: "Meeting notes",
    content: `**Date:** \n**Attendees:** \n\n## Agenda\n\n- \n\n## Notes\n\n- \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] Owner — task\n`,
  },
  {
    id: "spec",
    label: "Product spec",
    title: "Product spec",
    content: `## Problem\n\nWhat problem are we solving, and for whom?\n\n## Goals\n\n- \n\n## Non-goals\n\n- \n\n## Proposal\n\n\n## Open questions\n\n- [ ] \n`,
  },
  {
    id: "runbook",
    label: "Runbook",
    title: "Runbook",
    content: `## When to use this\n\n\n## Before you start\n\n- [ ] Access to …\n\n## Steps\n\n1. \n2. \n3. \n\n## Rollback\n\n1. \n\n## Contacts\n\n| Role | Person |\n| --- | --- |\n| Owner |  |\n`,
  },
  {
    id: "howto",
    label: "How-to",
    title: "How to …",
    content: `## Overview\n\n\n## Steps\n\n1. \n2. \n\n## Tips\n\n- \n\n## Related pages\n\n- \n`,
  },
]
