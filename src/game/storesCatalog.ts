export type StoreCategory =
  | 'market'
  | 'weapons'
  | 'fashion'
  | 'food'
  | 'auto'
  | 'lifestyle'
  | 'finance'
  | 'medical'

export type StoreItemAction =
  | { type: 'heal'; hp: number; hunger: number; focus?: number; stamina?: boolean }
  | { type: 'armor'; amount: number }
  | { type: 'ammo'; category: 'handgun' | 'smg' | 'shotgun' | 'rifle' | 'precision' | 'heavy' | 'throwable'; amount: number }
  | { type: 'weapon'; weaponId: string }
  | { type: 'attachment'; attachmentId: 'suppressor' | 'extMag' | 'reflex' }
  | { type: 'mask' }
  | { type: 'outfit' }
  | { type: 'hair'; style: string }
  | { type: 'tattoo'; id: string; label: string }
  | { type: 'gym'; kind: 'bench' | 'bag' }
  | { type: 'respray' }
  | { type: 'strip_tracker' }
  | { type: 'claim_personal' }
  | { type: 'refuel' }
  | { type: 'deposit_all' }
  | { type: 'withdraw_500' }
  | { type: 'fence_loot' }

export type StoreMenuItem = {
  id: string
  label: string
  price: number
  detail: string
  action: StoreItemAction
}

export type StoreSpec = {
  id: string
  name: string
  category: StoreCategory
  x: number
  z: number
  /** Rotation around Y in radians: 0 opens toward +Z, Math.PI/2 opens toward +X, -Math.PI/2 opens toward -X. */
  facing: number
  color: string
  accent: string
  hasGuard: boolean
  hasSilentAlarm: boolean
  hasDisplayCases: boolean
  registerReward: number
  safeLoot: number
  items: StoreMenuItem[]
}

export const STORE_CATEGORY_LABELS: Record<StoreCategory, string> = {
  market: 'CONVENIENCE',
  weapons: 'AMMUNITION',
  fashion: 'APPAREL & MASKS',
  food: 'DINING',
  auto: 'AUTO & CHOP SHOP',
  lifestyle: 'GYM, BARBER & INK',
  finance: 'BANK, FENCE & JEWELS',
  medical: 'PHARMACY & CLINIC',
}

export const STORES_CATALOG: StoreSpec[] = [
  {
    id: 'mart-ocean',
    name: '24/7 Ocean Drive Market',
    category: 'market',
    x: 26,
    z: -44,
    facing: -Math.PI / 2,
    color: '#ef9364',
    accent: '#49e0c8',
    hasGuard: false,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 420,
    safeLoot: 950,
    items: [
      { id: 'ps-cola', label: 'eCola & Snacks', price: 15, detail: '+30 HP · +40 Hunger', action: { type: 'heal', hp: 30, hunger: 40 } },
      { id: 'sprunk-pack', label: 'Sprunk Energy 4-Pack', price: 35, detail: '+100% Stamina · +35 Focus', action: { type: 'heal', hp: 20, hunger: 25, focus: 35, stamina: true } },
      { id: 'pocket-mask', label: 'Ski Mask', price: 85, detail: 'Toggle stealth face mask', action: { type: 'mask' } },
    ],
  },
  {
    id: 'gas-boulevard',
    name: 'Sunshine Gas & Mini-Mart',
    category: 'market',
    x: -54,
    z: -44,
    facing: -Math.PI / 2,
    color: '#e8b64c',
    accent: '#ff6454',
    hasGuard: false,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 380,
    safeLoot: 820,
    items: [
      { id: 'fill-tank', label: 'Refill Gas / EV Fast-Charge', price: 45, detail: '100% Fuel/Charge in active ride', action: { type: 'refuel' } },
      { id: 'gas-coffee', label: 'Thermos Roast & Jerky', price: 22, detail: '+35 HP · +45 Hunger · +25 Focus', action: { type: 'heal', hp: 35, hunger: 45, focus: 25 } },
      { id: 'road-snack', label: 'Highway Energy Shot', price: 40, detail: 'Refill Stamina & +40 Focus', action: { type: 'heal', hp: 15, hunger: 15, focus: 40, stamina: true } },
    ],
  },
  {
    id: 'ammunation-flagship',
    name: 'Ammu-Nation Flagship',
    category: 'weapons',
    x: 26,
    z: -116,
    facing: -Math.PI / 2,
    color: '#5a7882',
    accent: '#ff5268',
    hasGuard: true,
    hasSilentAlarm: true,
    hasDisplayCases: true,
    registerReward: 680,
    safeLoot: 1950,
    items: [
      { id: 'kevlar-100', label: 'Heavy Ballistic Vest', price: 200, detail: '+100 Body Armor', action: { type: 'armor', amount: 100 } },
      { id: 'carbine-rifle', label: 'Carbine Rifle', price: 750, detail: 'Select 5.56mm Carbine + 60 rds', action: { type: 'weapon', weaponId: 'carbine' } },
      { id: 'pump-12g', label: 'Pump-Action 12-Gauge', price: 480, detail: 'Select 12G Pump + ammo', action: { type: 'weapon', weaponId: 'pump_shotgun' } },
      { id: 'suppressor-mod', label: 'Tactical Suppressor', price: 180, detail: 'Attach suppressor on equipped gun', action: { type: 'attachment', attachmentId: 'suppressor' } },
      { id: 'extmag-mod', label: 'Extended Magazine', price: 140, detail: '+50% magazine capacity', action: { type: 'attachment', attachmentId: 'extMag' } },
      { id: 'ammo-crate', label: 'Full Rifle & Handgun Ammo', price: 110, detail: '+90 Rifle · +60 Handgun', action: { type: 'ammo', category: 'rifle', amount: 90 } },
    ],
  },
  {
    id: 'surplus-armory',
    name: 'Tactical Surplus & Pawn Armory',
    category: 'weapons',
    x: -54,
    z: 28,
    facing: -Math.PI / 2,
    color: '#6e7b63',
    accent: '#f0b848',
    hasGuard: true,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 590,
    safeLoot: 1650,
    items: [
      { id: 'mpx-smg', label: 'Tactical MPX-9 SMG', price: 540, detail: 'Equip MPX + AP ammo', action: { type: 'weapon', weaponId: 'mpx' } },
      { id: 'ak-rifle', label: 'Heavy Tactical AK', price: 820, detail: 'Equip Heavy AK-style rifle', action: { type: 'weapon', weaponId: 'ak_rifle' } },
      { id: 'dmr-sniper', label: 'Marksman DMR', price: 980, detail: 'Precision semi-auto rifle', action: { type: 'weapon', weaponId: 'dmr' } },
      { id: 'frag-pack', label: 'Frag Grenades (x3)', price: 180, detail: '+3 Throwable Frags', action: { type: 'ammo', category: 'throwable', amount: 3 } },
      { id: 'reflex-mod', label: 'Reflex Optic & Foregrip', price: 160, detail: '-30% spread & -25% recoil', action: { type: 'attachment', attachmentId: 'reflex' } },
    ],
  },
  {
    id: 'binco-streetwear',
    name: 'Binco Streetwear',
    category: 'fashion',
    x: -84,
    z: 28,
    facing: Math.PI / 2,
    color: '#d97196',
    accent: '#76e8df',
    hasGuard: false,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 340,
    safeLoot: 720,
    items: [
      { id: 'binco-outfit', label: 'Change Street Outfit', price: 90, detail: 'Clears logged Outfit APB', action: { type: 'outfit' } },
      { id: 'binco-armor', label: 'Reinforced Hoodie', price: 160, detail: '+55 Light Armor & Outfit swap', action: { type: 'armor', amount: 55 } },
    ],
  },
  {
    id: 'suburban-fashion',
    name: 'Suburban Urban Fashion',
    category: 'fashion',
    x: 26,
    z: -196,
    facing: -Math.PI / 2,
    color: '#6fb6c4',
    accent: '#ffcf6e',
    hasGuard: false,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 410,
    safeLoot: 900,
    items: [
      { id: 'sub-outfit', label: 'Designer Street Jacket', price: 140, detail: 'Clears logged Outfit APB', action: { type: 'outfit' } },
      { id: 'sub-shades', label: 'Bandana & Shades Disguise', price: 95, detail: 'Equips stealth concealment mask', action: { type: 'mask' } },
    ],
  },
  {
    id: 'ponsonbys-luxury',
    name: 'Ponsonbys Luxury Boutique',
    category: 'fashion',
    x: 26,
    z: -276,
    facing: -Math.PI / 2,
    color: '#c7b598',
    accent: '#ffe38c',
    hasGuard: true,
    hasSilentAlarm: true,
    hasDisplayCases: true,
    registerReward: 780,
    safeLoot: 2400,
    items: [
      { id: 'tailored-suit', label: 'Tailored Vice Suit', price: 320, detail: 'Clears Outfit APB · +Respect feel', action: { type: 'outfit' } },
      { id: 'lined-blazer', label: 'Ballistic Executive Blazer', price: 380, detail: '+85 Armor & Outfit swap', action: { type: 'armor', amount: 85 } },
    ],
  },
  {
    id: 'masks-costumes',
    name: 'Vice Masks & Costumes',
    category: 'fashion',
    x: -24,
    z: 26,
    facing: Math.PI / 2,
    color: '#a36fd9',
    accent: '#ff6ca8',
    hasGuard: false,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 360,
    safeLoot: 780,
    items: [
      { id: 'neon-mask', label: 'Neon Balaclava Mask', price: 75, detail: 'Equips face-hiding mask [V]', action: { type: 'mask' } },
      { id: 'disguise-kit', label: 'Full Alias Wardrobe Swap', price: 120, detail: 'Clears logged Outfit APB', action: { type: 'outfit' } },
    ],
  },
  {
    id: 'leonida-jewelers',
    name: 'Leonida Gold & Diamond Jewelers',
    category: 'finance',
    x: -84,
    z: -44,
    facing: Math.PI / 2,
    color: '#d9c698',
    accent: '#7bf5ff',
    hasGuard: true,
    hasSilentAlarm: true,
    hasDisplayCases: true,
    registerReward: 1150,
    safeLoot: 4800,
    items: [
      { id: 'fence-gems', label: 'Appraise & Sell Stolen Jewels', price: 0, detail: 'Converts Uncleaned Loot at 85%', action: { type: 'fence_loot' } },
      { id: 'gift-watch', label: 'Partner Gift Watch', price: 450, detail: '+10 Partner Bond & Respect', action: { type: 'outfit' } },
    ],
  },
  {
    id: 'lucky-star-pawn',
    name: 'Lucky Star Pawn & Fence',
    category: 'finance',
    x: -54,
    z: 116,
    facing: -Math.PI / 2,
    color: '#d68849',
    accent: '#ffe073',
    hasGuard: true,
    hasSilentAlarm: false,
    hasDisplayCases: true,
    registerReward: 620,
    safeLoot: 2100,
    items: [
      { id: 'fence-duffel', label: 'Fence Uncleaned Loot Duffel', price: 0, detail: 'Launder stolen loot into clean cash (85%)', action: { type: 'fence_loot' } },
      { id: 'pawn-revolver', label: 'Pawn Heavy .44 Revolver', price: 440, detail: 'Equip Heavy Revolver', action: { type: 'weapon', weaponId: 'revolver' } },
      { id: 'pawn-crowbar', label: 'Steel Pry Crowbar', price: 90, detail: 'Heavy melee pry tool', action: { type: 'weapon', weaponId: 'crowbar' } },
    ],
  },
  {
    id: 'burger-shot',
    name: 'Burger Shot',
    category: 'food',
    x: -24,
    z: 116,
    facing: Math.PI / 2,
    color: '#e55c4a',
    accent: '#ffdb57',
    hasGuard: false,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 350,
    safeLoot: 760,
    items: [
      { id: 'bleeder-meal', label: 'The Bleeder Combo', price: 18, detail: '+55 HP · +65 Hunger', action: { type: 'heal', hp: 55, hunger: 65 } },
      { id: 'heart-stopper', label: '6lb Heart Stopper', price: 32, detail: '+100 HP · +95 Hunger', action: { type: 'heal', hp: 100, hunger: 95 } },
    ],
  },
  {
    id: 'cluckin-bell',
    name: "Cluckin' Bell",
    category: 'food',
    x: -84,
    z: 116,
    facing: Math.PI / 2,
    color: '#efc454',
    accent: '#df4a5e',
    hasGuard: false,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 340,
    safeLoot: 740,
    items: [
      { id: 'cluckin-bucket', label: 'Fowl Bucket Feast', price: 24, detail: '+70 HP · +75 Hunger', action: { type: 'heal', hp: 70, hunger: 75 } },
      { id: 'wings-box', label: 'Spicy Wings & Shake', price: 14, detail: '+40 HP · +45 Hunger', action: { type: 'heal', hp: 40, hunger: 45 } },
    ],
  },
  {
    id: 'bean-machine',
    name: 'Bean Machine Coffee & Bakery',
    category: 'food',
    x: 26,
    z: -145,
    facing: -Math.PI / 2,
    color: '#8f6246',
    accent: '#78e6cc',
    hasGuard: false,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 310,
    safeLoot: 640,
    items: [
      { id: 'double-espresso', label: 'Double Vice Espresso', price: 12, detail: '+100% Stamina · +55 Focus', action: { type: 'heal', hp: 20, hunger: 25, focus: 55, stamina: true } },
      { id: 'croissant-latte', label: 'Cuban Roast & Pastry', price: 20, detail: '+45 HP · +50 Hunger · +40 Focus', action: { type: 'heal', hp: 45, hunger: 50, focus: 40, stamina: true } },
    ],
  },
  {
    id: 'vice-customs',
    name: "Vice Customs & Pay 'n' Spray",
    category: 'auto',
    x: -54,
    z: 196,
    facing: -Math.PI / 2,
    color: '#4f7a96',
    accent: '#ffaa47',
    hasGuard: false,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 510,
    safeLoot: 1350,
    items: [
      { id: 'custom-respray', label: 'Full Repair, Respray & Plate Swap', price: 150, detail: 'Fixes body damage & drops plate APB', action: { type: 'respray' } },
      { id: 'claim-personal-ride', label: 'Register as Personal Vehicle', price: 250, detail: 'Unlocks Trunk Armory & Mobile Delivery', action: { type: 'claim_personal' } },
      { id: 'custom-fuel', label: 'Full Tank & Nitro Tune', price: 45, detail: 'Refills Fuel/EV Battery to 100%', action: { type: 'refuel' } },
    ],
  },
  {
    id: 'chop-shop',
    name: 'Chop Shop & Tracker Removal',
    category: 'auto',
    x: -24,
    z: 196,
    facing: Math.PI / 2,
    color: '#5c5550',
    accent: '#ff5268',
    hasGuard: true,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 640,
    safeLoot: 2200,
    items: [
      { id: 'strip-gps', label: 'Strip Exotic Police GPS Tracker', price: 180, detail: 'Disables Tier 3 live police ping & swaps plate', action: { type: 'strip_tracker' } },
      { id: 'chop-repair', label: 'Black-Market Plate & Bodywork', price: 130, detail: 'Resprays ride + cleans APB', action: { type: 'respray' } },
      { id: 'chop-claim', label: 'Forge Pink Slip (Personal Car)', price: 200, detail: 'Claims current car as Personal Vehicle', action: { type: 'claim_personal' } },
    ],
  },
  {
    id: 'muscle-iron-gym',
    name: 'Muscle Beach Iron Gym',
    category: 'lifestyle',
    x: 35,
    z: 24,
    facing: Math.PI / 2,
    color: '#e57c68',
    accent: '#76e8df',
    hasGuard: false,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 290,
    safeLoot: 620,
    items: [
      { id: 'iron-bench', label: 'Heavy Bench Press Set', price: 15, detail: '+Muscle · +Stamina · -Fat', action: { type: 'gym', kind: 'bench' } },
      { id: 'iron-bag', label: 'Heavy Bag Boxing Drill', price: 15, detail: '+Melee Power · +Stamina', action: { type: 'gym', kind: 'bag' } },
      { id: 'protein-shake', label: 'Whey & Creatine Shake', price: 25, detail: '+60 HP · +100% Stamina', action: { type: 'heal', hp: 60, hunger: 45, stamina: true } },
    ],
  },
  {
    id: 'herr-kutz',
    name: 'Herr Kutz Barber & Salon',
    category: 'lifestyle',
    x: -142,
    z: -44,
    facing: Math.PI / 2,
    color: '#c96f86',
    accent: '#fff0c8',
    hasGuard: false,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 330,
    safeLoot: 700,
    items: [
      { id: 'cut-fade', label: 'Vice High Fade', price: 50, detail: 'Clears Face ID pressure & updates look', action: { type: 'hair', style: 'Vice High Fade' } },
      { id: 'cut-slick', label: 'Slick Ocean Sweep', price: 65, detail: 'Clears Face ID pressure & updates look', action: { type: 'hair', style: 'Ocean Sweep' } },
      { id: 'cut-buzz', label: 'Clean Buzzcut', price: 35, detail: 'Clears Face ID pressure & updates look', action: { type: 'hair', style: 'Buzzcut' } },
    ],
  },
  {
    id: 'ink-steel-tattoo',
    name: 'Ink & Steel Tattoo Parlor',
    category: 'lifestyle',
    x: -84,
    z: 196,
    facing: Math.PI / 2,
    color: '#4e4b62',
    accent: '#ff6ba8',
    hasGuard: false,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 390,
    safeLoot: 880,
    items: [
      { id: 'ink-palm', label: 'Neon Palm Sleeve', price: 140, detail: '+Intimidation in holdups & +Respect', action: { type: 'tattoo', id: 'neon-palm', label: 'Neon Palm Sleeve' } },
      { id: 'ink-viper', label: 'Leonida Viper Back Piece', price: 220, detail: '+Intimidation in holdups & +Respect', action: { type: 'tattoo', id: 'viper-back', label: 'Leonida Viper' } },
    ],
  },
  {
    id: 'fleeca-branch',
    name: 'Fleeca Bank Branch & ATM',
    category: 'finance',
    x: -142,
    z: -116,
    facing: Math.PI / 2,
    color: '#3f7665',
    accent: '#82f5c0',
    hasGuard: true,
    hasSilentAlarm: true,
    hasDisplayCases: false,
    registerReward: 1450,
    safeLoot: 6500,
    items: [
      { id: 'bank-deposit-all', label: 'Deposit All Cash to BuckMe', price: 0, detail: 'Protects 100% cash from Wasted fees', action: { type: 'deposit_all' } },
      { id: 'bank-withdraw', label: 'Withdraw $500 Cash', price: 0, detail: 'Moves $500 from Bank to pocket', action: { type: 'withdraw_500' } },
    ],
  },
  {
    id: 'pharmacy-clinic',
    name: '24/7 Pharmacy & Clinic',
    category: 'medical',
    x: -142,
    z: 28,
    facing: Math.PI / 2,
    color: '#88c9cc',
    accent: '#ff5c72',
    hasGuard: false,
    hasSilentAlarm: false,
    hasDisplayCases: false,
    registerReward: 460,
    safeLoot: 1400,
    items: [
      { id: 'trauma-medkit', label: 'Trauma First-Aid Kit', price: 65, detail: 'Full 100 HP recovery + bandages', action: { type: 'heal', hp: 100, hunger: 20 } },
      { id: 'adrenaline-shot', label: 'Adrenaline Focus Shot', price: 90, detail: '+50 HP · 100% Stamina · +100% Focus', action: { type: 'heal', hp: 50, hunger: 10, focus: 100, stamina: true } },
    ],
  },
]

export function getStoreById(id: string): StoreSpec | undefined {
  return STORES_CATALOG.find(s => s.id === id)
}

/**
 * Three-Tier Economy:
 * - Deposit Cash on Hand -> protected BuckMe Bank Account
 * - Wasted/Busted forfeits Cash on Hand (100%) while leaving Bank Balance untouched
 * - Fencing converts Uncleaned Loot duffel into clean Cash on Hand (85% rate)
 */
export function depositCashToBank(state: { money: number; bankBalance: number }, amount?: number): number {
  const cash = Math.max(0, Math.floor(state.money))
  const toMove = amount === undefined ? cash : Math.min(cash, Math.max(0, Math.floor(amount)))
  state.money -= toMove
  state.bankBalance += toMove
  return toMove
}

export function applyWastedEconomyPenalty(state: { money: number; bankBalance: number; uncleanedLoot: number }): {
  lostCash: number
  lostLoot: number
  bankProtected: number
} {
  const lostCash = Math.max(0, Math.floor(state.money))
  const lostLoot = Math.max(0, Math.floor(state.uncleanedLoot))
  state.money = 0
  state.uncleanedLoot = 0
  return {
    lostCash,
    lostLoot,
    bankProtected: Math.max(0, Math.floor(state.bankBalance)),
  }
}

export function fenceUncleanedLoot(state: { money: number; uncleanedLoot: number }, rate = 0.85): {
  fencedGross: number
  cleanPayout: number
} {
  const gross = Math.max(0, Math.floor(state.uncleanedLoot))
  if (gross <= 0) return { fencedGross: 0, cleanPayout: 0 }
  const cleanPayout = Math.max(1, Math.round(gross * rate))
  state.uncleanedLoot = 0
  state.money += cleanPayout
  return { fencedGross: gross, cleanPayout }
}
