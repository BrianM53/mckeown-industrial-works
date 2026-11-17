/**
 * NPC dialogue — IN-WORLD FICTION. Owner: npc module (will expand this file).
 * Keep lines short (1–3 per conversation). Mix useful factory info, gossip,
 * absurd safety commentary, and only occasional hyperbolic "CEO" mythology.
 * Never state real facts about Brian here (real facts live in profile.ts etc.).
 */
export interface DialogueEntry {
  npcId: string
  name: string
  role: string
  /** Each conversation is 1–3 lines; one is picked per interaction. */
  conversations: string[][]
}

export const DIALOGUE: DialogueEntry[] = [
  {
    npcId: 'greeter',
    name: 'Dot',
    role: 'Visitor Intake',
    conversations: [
      ['Welcome to McKeown Industrial Works! Hard hats are mandatory. Hard heads are encouraged.', 'Press M for the site directory if you get lost. Everyone gets lost.'],
      ['We haven’t had an accident in fourteen minutes. New record.'],
    ],
  },
]
