import type { Achievement } from './types'

/**
 * Optional achievement list. Modules unlock with
 *   events.emit('achievement', { id: 'goal' })
 * The ui module records unlocks (game store) and shows a small toast.
 */
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'clocked-in', title: 'Clocked In', description: 'Took your first steps on the factory floor.', hidden: false },
  { id: 'resume-printed', title: 'Paperwork Complete', description: 'Printed a résumé at the Personnel Office.', hidden: false },
  { id: 'all-stations', title: 'Full Site Tour', description: 'Visited all five main destinations.', hidden: false },
  { id: 'launch-witness', title: 'Witness Statement', description: 'Watched a rocket launch.', hidden: false },
  { id: 'disassembly-witness', title: 'Unscheduled Disassembly', description: 'Saw a launch not go to plan.', hidden: false },
  { id: 'forklift-driver', title: 'Licensed (Probably)', description: 'Drove the company forklift.', hidden: false },
  { id: 'forklift-flipped', title: 'Company Culture', description: 'Put the forklift on its roof.', hidden: true },
  { id: 'tackled', title: 'Safety Briefing', description: 'Got tackled by the safety inspector.', hidden: false },
  { id: 'line-certified', title: 'Line Certified', description: 'Hit the production target at the Line Supervisor Console.', hidden: false },
  { id: 'goal', title: 'Back of the Net', description: 'Scored a goal in the Recreation Yard.', hidden: false },
  { id: 'volley', title: 'Over the Net', description: 'Bumped the volleyball over the net.', hidden: false },
  { id: 'night-shift', title: 'Lights Out', description: 'Pressed the Night Shift button.', hidden: false },
  { id: 'do-not-press', title: 'Reading Comprehension', description: 'Pressed the button labeled DO NOT PRESS.', hidden: true },
  { id: 'qc-rejected', title: 'Too Much Initiative', description: 'Walked through the QC scanner arch.', hidden: true },
  { id: 'synergy', title: 'Synergy', description: 'Found the executive office.', hidden: true },
  { id: 'employee-of-month', title: 'Employee of the Month', description: 'Inspected the Employee of the Month wall.', hidden: true },
  { id: 'chatty', title: 'Water-Cooler Regular', description: 'Talked to five different workers.', hidden: false },
  { id: 'machine-kick', title: 'Percussive Maintenance', description: 'Saw a machine fixed by kicking it.', hidden: true },
  { id: 'radio-jingle', title: 'Station Identification', description: 'Played the station jingle.', hidden: true },
]
