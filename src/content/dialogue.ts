/**
 * NPC dialogue — IN-WORLD FICTION. Owner: npc module.
 *
 * Rules (enforced by src/npc/npc.dialogue.test.ts):
 *  - every worker has 3–5 conversations; each conversation is 1–3 lines of ≤ 140 characters;
 *  - a mix of useful factory hints, workplace gossip and absurd safety commentary;
 *  - the mythical "CEO" shows up only occasionally (well under 30% of conversations) and
 *    workers rarely say Brian's name;
 *  - NEVER real facts about Brian here (employer, school, projects, podcast, places).
 *    Real facts live in profile.ts / projects.ts / resume.ts / stations.ts and are shown
 *    by the portfolio panels. Hints may point at those stations, never restate them.
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
      [
        'Welcome to McKeown Industrial Works! Hard hats are mandatory. Hard heads are encouraged.',
        'Lost already? Press M for the site directory. Everyone gets lost. It’s practically onboarding.',
      ],
      ['The yellow building next door is the Personnel Office. The Résumé-O-Matic prints the real résumé.', 'Mostly real paper, too.'],
      ['We haven’t had an accident in fourteen minutes. New record.', 'I baked a cake to celebrate. Somebody dropped it in the smelter.'],
      ['Visitor tip: anything with a glowing ring on the floor responds to E. Please poke responsibly.'],
      ['Rumor says the CEO once fixed a jammed conveyor by staring at it until it apologized.'],
    ],
  },
  {
    npcId: 'smelter',
    name: 'Rocco',
    role: 'Smelter Operator',
    conversations: [
      ['This press has two settings: ON and UNION NEGOTIATION.'],
      ['The furnace runs at fifteen hundred degrees. My coffee runs hotter. Nobody asks questions.'],
      [
        'Want the whole spine faster? The Line Supervisor Console by the aisle tunes it.',
        'Crank the conveyors too far and QC starts crying. Real tears. It’s a whole thing.',
      ],
      ['Soot is just factory glitter.', 'If I come out of that furnace looking like a chimney sweep, act natural.'],
      ['Everything on this belt ends up in a rocket eventually. Even my lunch, that one time.'],
    ],
  },
  {
    npcId: 'circuit',
    name: 'Priya',
    role: 'Guidance Electronics',
    conversations: [
      ['I solder guidance boards. The rockets mostly ignore them, but it’s the thought that counts.'],
      ['Our guidance system has three modes: up, sideways, and “interesting.”'],
      ['See the tumbler by the arch? It sputters when it’s bored.', 'A firm kick restores morale. Its morale. Not mine.'],
      ['Static electricity is just the factory saying hello.', 'Loudly. Through your elbow.'],
    ],
  },
  {
    npcId: 'qc',
    name: 'Vera',
    role: 'Quality Control',
    conversations: [
      ['Every part passes through my arch. Most pass inspection. Some just pass out.'],
      ['I once rejected a rocket for “too much initiative.” Walk through the arch and see what it thinks of you.'],
      [
        'Inspection thoroughness is a dial on the Line Supervisor Console.',
        'Turn it up and fewer rockets come apart. Turn it down and everything ships. Everything.',
      ],
      ['Defect rate is down four percent. Up nine. Sideways two. Statistics are a journey.'],
    ],
  },
  {
    npcId: 'chief',
    name: 'Bev',
    role: 'Tower Crew Chief',
    conversations: [
      [
        'Six stages: chassis, tanks, fins, guidance, nose cone and “attachments.”',
        'Nobody knows who orders the attachments. They just arrive.',
      ],
      [
        'When the rocket’s finished we roll it to the pad and count down. Watch from the observation deck.',
        'Not from the blast zone. The safety inspector can outrun our rockets.',
      ],
      ['The CEO increased productivity 400% by pointing at a spreadsheet.'],
      ['Don’t mind the robot arm. It only throws people it likes.', 'It likes me a LOT.'],
      ['That disassembly counter by the pad? We call it “the honesty board.”'],
    ],
  },
  {
    npcId: 'driver',
    name: 'Dale',
    role: 'Employee of the Month',
    conversations: [
      ['Employee of the Month. Twelve months running.', 'Nobody else will drive the forklift.'],
      [
        'The forklift lives right here in the Maintenance Bay. Walk up and press E to drive.',
        'If you flip it, R puts it back on its wheels. Ask me how I know.',
      ],
      ['The forklift is company property. The dents are company culture.'],
      ['I’m not napping. I’m load-testing this conveyor. Very carefully. With my eyes closed.'],
      ['Rule one of forklifting: everything is a ramp if you believe in yourself.'],
    ],
  },
  {
    npcId: 'pipe',
    name: 'Marisol',
    role: 'Pipe & Valve Machinist',
    conversations: [
      ['Every valve gets tested twice: once by me, once by the rocket. The rocket grades harder.'],
      ['Lefty loosey, righty tighty, upside down… that one’s a rocket now.'],
      [
        'Heading west? The Control Room and the Server Hall are both off the west avenue.',
        'Big screens in one, blinking racks in the other. That’s where the real portfolio stuff lives.',
      ],
      ['Rumor is the CEO doesn’t take the stairs. The stairs take him.'],
      ['My lathe makes a noise like a sad trombone right before it works perfectly. I don’t ask.'],
    ],
  },
  {
    npcId: 'tank',
    name: 'Gus',
    role: 'Tank Fabricator',
    conversations: [
      ['Don’t touch the green vat. Don’t drink the green vat. Don’t make eye contact with the green vat.'],
      ['We weld the tanks airtight. Then someone adds “questionable attachments” and we pretend not to see.'],
      ['I’ve never met the CEO, but they say he can smell inefficiency.', 'From the parking lot.'],
      ['The Rec Yard is past the east avenue. Bring shin guards. Accounting plays dirty.'],
    ],
  },
  {
    npcId: 'operator',
    name: 'Nadia',
    role: 'Control Room Operator',
    conversations: [
      ['Every screen in here is live. Well. Live-ish. The numbers are simulated. The panic is real.'],
      ['The big console is the real deal — walk up and press E. I just watch the blinking lights.'],
      ['Somebody turned the efficiency knob to eleven. Now the coffee machine files status reports.'],
      ['Legend says the CEO can read a Gantt chart upside down. In the dark. While it’s on fire.'],
    ],
  },
  {
    npcId: 'dj',
    name: 'DJ Torque',
    role: 'Radio Booth',
    conversations: [
      ['You’re listening to KMIW, the only station broadcasting live from inside a fuel tank.'],
      ['That interview on the desk is the real thing. Walk up and press E for the episode.'],
      ['Traffic report: the forklift is on the sidewalk again. Avoid the sidewalk. Avoid the forklift.'],
      ['Up next: four hours of compressor noise, requested by the night shift. Again.'],
    ],
  },
  {
    npcId: 'sysadmin',
    name: 'Glenn',
    role: 'Sysadmin',
    conversations: [
      ['Have you tried turning the factory off and on again?', 'There’s a Night Shift button by the aisle. Please don’t. Please do.'],
      ['The giant fan in the back cools the racks. Also dries laundry. Unofficially.'],
      ['The terminal up front lists the actual repositories. I just stop people unplugging it to charge forklifts.'],
      ['Uptime this week: 99.9 percent. The other 0.1 percent was a rocket.'],
    ],
  },
  {
    npcId: 'scientist',
    name: 'Dr. Fenwick',
    role: 'R&D Scientist',
    conversations: [
      ['The scanner and the rowing rig in here are proper projects — press E at each one for the write-up.', 'The big red button is not a project.'],
      ['Do not press the big red button. It is load-bearing for my sanity.'],
      ['Our safety goggles are rated for “mostly.”'],
      ['I asked for a bigger budget. The CEO approved a bigger button.'],
    ],
  },
  {
    npcId: 'lounger-a',
    name: 'Moe',
    role: 'On Break',
    conversations: [
      ['I’m on break. I’ve been on break since the last rocket.', 'Which rocket? Exactly.'],
      ['The vending machine takes coins, tokens and, one time, an entire wrench.'],
      ['Somebody keeps printing memos outside. Last one was ten meters long.', 'Subject line: “Please Keep Memos Brief.”'],
    ],
  },
  {
    npcId: 'lounger-b',
    name: 'Lou',
    role: 'On Break',
    conversations: [
      ['The executive office back there is locked.', 'Through the glass I saw one pie chart. It just said SYNERGY.'],
      ['Break room rules: no rockets, no forklifts, no talking about the green vat.'],
      ['They say the CEO once negotiated with a conveyor belt. The belt blinked first.'],
      ['Lunch special is “mystery stew.” The mystery is which production line it came off.'],
    ],
  },
]

/** What the forklift driver mumbles when you talk to him mid-nap. */
export const SLEEP_TALK: string[][] = [
  ['Zzz… five more minutes… the forklift can wait…', '…vroom… *snore*'],
  ['*snore* …Employee of the Month… again… *mumble*'],
  ['Mmmf… everything is a ramp… zzz…'],
]

/** Short floating speech bubbles (ambient chatter), per worker. ≤ 40 characters each. */
export const AMBIENT_CHATTER: Record<string, string[]> = {
  greeter: ['Welcome in!', 'Hard hat? Hard hat.', 'Directory’s on M!', 'Mind the forklift!'],
  smelter: ['Hot hot hot.', 'Smells like progress.', 'Who moved my tongs?', 'Glitter? Soot.'],
  circuit: ['Solder, solder, solder.', 'Static check!', 'Up. Sideways. Up.', 'Board 42, nominal.'],
  qc: ['Pass. Pass. Ehh… pass.', 'Hmm. Rejected.', 'Nominal. Probably.', 'Clipboard says no.'],
  chief: ['Who ordered more fins?', 'Stage four, people!', 'Attachments again?', 'Nominal!'],
  driver: ['Ten more minutes…', 'Coffee. Now.', 'Beep beep.', 'I’m awake. Mostly.'],
  pipe: ['Righty tighty.', 'Measure twice…', 'Valve 9 is sulking.', 'Smells like threads.'],
  tank: ['Weld, weld, weld.', 'Airtight. Ish.', 'Don’t touch the vat.', 'Tank 3 is humming.'],
  operator: ['All green. Mostly.', 'Who touched the knob?', 'Graph goes up!', 'Screens nominal.'],
  dj: ['KMIW, all rocket radio!', 'Request line’s open!', 'Spinning compressor B.', 'Live from a tank!'],
  sysadmin: ['It’s always DNS.', 'Uptime: heroic.', 'Do NOT unplug that.', 'Fan speed: yes.'],
  scientist: ['Fascinating.', 'Goggles: mostly on.', 'For science!', 'Do not press it.'],
  'lounger-a': ['Is it Friday yet?', 'Break, day three.', 'Snack o’clock.', 'One more coffee.'],
  'lounger-b': ['Synergy…', 'Mystery stew again?', 'Peeking. Not peeking.', 'Who took my mug?'],
}

/** Lines workers shout during the ambient gags. */
export const GAG_QUIPS = {
  napSnore: 'Zzz…',
  napUp: 'Ta-da! Totally awake.',
  sootCough: '*cough*',
  sootShake: 'Smells like progress.',
  vatOops: 'Not again…',
  vatShrug: 'Still under warranty.',
  kickBefore: 'Not today…',
  kickAfter: 'Percussive maintenance!',
  standoffA1: 'Coming through!',
  standoffB1: 'No, YOU back up.',
  standoffA2: 'BEEP BEEP!',
  standoffB2: 'HONK!',
  standoffEnd: 'Fine.',
  armGrab: 'Hey—',
  armFoam: 'I’m OK!',
  armThumbs: 'Nailed the landing.',
  memo: 'Another memo?',
} as const

/** Reaction when the forklift bumps a worker. */
export const BUMP_LINES: string[] = ['Hey! I’m walking here!', 'Watch the toes!', 'Company culture, huh?', 'Beep next time!']

/** Reactions to launch outcomes (bubbles over watching workers). */
export const LAUNCH_REACTIONS = {
  success: ['WOOO!', 'Nominal!', 'Ship it!'],
  wobble: ['…nominal?', 'Close enough!', 'It counts!'],
  breakup: ['Oh no.', 'Unscheduled!', 'Fins!'],
  explosion: ['DUCK!', 'Counter reset…', 'Oof.'],
} as const

/** Night Shift panic shouts. */
export const PANIC_LINES: string[] = ['WHO TURNED OFF THE SUN?', 'Lights! LIGHTS!', 'I can’t see my clipboard!', 'Nobody move!']
