// Educational content for the Learn section. Data-driven so the text is easy to
// edit and cover screenshots can be dropped in later with a one-line change.
//
// To add a cover image: drop the file in src/renderer/src/assets/concepts/,
// import it below, and set `cover:` on the matching concept.

import fvgCover from '../assets/concepts/fvgs.png'
import liquidityCover from '../assets/concepts/liquidity.png'
import candlesticksCover from '../assets/concepts/candlesticks.png'
import cisdCover from '../assets/concepts/cisd.png'
import mmxmCover from '../assets/concepts/mmxm.png'
import smtsCover from '../assets/concepts/smts.png'

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'subhead'; text: string }
  | { kind: 'list'; items: string[] }

export interface Concept {
  id: string
  title: string
  blurb: string // one-line summary shown on the card
  cover?: string // imported image asset; undefined -> placeholder cover
  body?: Block[] // written description
  mentorshipOnly?: boolean
  mentorshipUrl?: string // defaults to MENTORSHIP_URL
}

// Same community link the sidebar already opens.
export const MENTORSHIP_URL = 'https://discord.gg/3NCzYnRtKd'

const MENTORSHIP_NOTE =
  'To learn about this, please view the videos and description in the private mentorship in the respective location.'

export const CONCEPTS: Concept[] = [
  {
    id: 'fvgs',
    title: 'FVGs',
    blurb: 'Fair Value Gaps - price imbalances left behind by aggressive moves.',
    cover: fvgCover,
    body: [
      { kind: 'p', text: 'FVGs are price imbalances in the market.' },
      {
        kind: 'list',
        items: [
          'They happen when price moves aggressively in one direction, leaving behind a gap between candles.',
          'It essentially means the market moved too quickly and did not fill enough orders, so there are resting orders left behind within the gap. Because of this, price will often come back into the area and fill the gap.'
        ]
      },
      { kind: 'p', text: 'FVGs form with three candles.' },
      { kind: 'subhead', text: 'Bullish FVGs form:' },
      {
        kind: 'list',
        items: ['Top wick of the first candle', 'Bottom wick of the third candle', 'The gap in the middle is the FVG']
      },
      { kind: 'subhead', text: 'Bearish FVGs form:' },
      {
        kind: 'list',
        items: ['Bottom wick of the first candle', 'Top wick of the third candle', 'The gap in the middle is the FVG']
      }
    ]
  },
  {
    id: 'liquidity',
    title: 'Liquidity',
    blurb: 'Where orders rest in the market - the fuel price draws toward.',
    cover: liquidityCover,
    body: [
      { kind: 'p', text: 'Liquidity is where orders are sitting in the market.' },
      { kind: 'subhead', text: 'These could be:' },
      {
        kind: 'list',
        items: ['Highs', 'Lows', 'Equal Highs / Lows', 'Previous Day Highs / Lows', 'Session Highs / Lows']
      },
      {
        kind: 'p',
        text: 'Retail traders place orders such as stop losses at these areas, so the market loves to move to take them out. The market needs liquidity to move, so it generally aims to go take this liquidity.'
      },
      {
        kind: 'list',
        items: ['Buyside liquidity is found above highs.', 'Sellside liquidity is found below lows.']
      },
      { kind: 'p', text: "Think of it as fuel for the market - it's where price will draw towards." }
    ]
  },
  {
    id: 'candlesticks',
    title: 'CandleSticks',
    blurb: 'How a single candle represents price movement over a timeframe.',
    cover: candlesticksCover,
    body: [
      { kind: 'p', text: 'A candle represents price movement over a set timeframe.' },
      { kind: 'subhead', text: '4 main parts of a candle:' },
      {
        kind: 'list',
        items: [
          'Open: where price started during the candle',
          'Close: where price ended up / finished',
          'High: highest price reached',
          'Low: lowest price reached'
        ]
      },
      {
        kind: 'list',
        items: [
          'Bullish candle: price closed higher than it opened. Usually shown as GREEN.',
          'Bearish candle: price closed lower than it opened. Usually shown as RED.'
        ]
      },
      {
        kind: 'list',
        items: [
          'Candle body: the thick part of the candle. Shows the distance between open and close.',
          'Wick: the thin lines above and below a body. Shows how far price moved before rejecting that area.'
        ]
      },
      {
        kind: 'p',
        text: "Candles help us understand what's going on in the markets between buyers and sellers, and help to distinguish the direction of price and what confluences to use."
      },
      {
        kind: 'p',
        text: 'Confluences: a combination of theories and concepts that, added together, make a trade more powerful.'
      }
    ]
  },
  {
    id: 'cisd',
    title: 'Change in State of Delivery',
    blurb: 'CISD - when the market changes the way it delivers price.',
    cover: cisdCover,
    body: [
      { kind: 'p', text: 'A CISD is when the market changes the way it is delivering price.' },
      { kind: 'subhead', text: 'Price may go from being delivered:' },
      { kind: 'list', items: ['Bearish to Bullish', 'Bullish to Bearish'] },
      {
        kind: 'p',
        text: "It's a confluence that helps to confirm reversals, continuations, and other confluences we use later."
      },
      {
        kind: 'p',
        text: 'Note: this is the ICT definition of CISDs; we change it slightly in the later levels of the mentorship.'
      }
    ]
  },
  {
    id: 'mmxm',
    title: 'Market Maker Models',
    blurb: 'MMXM - how the market moves when delivering price in one direction.',
    cover: mmxmCover,
    body: [
      {
        kind: 'p',
        text: 'The Market Maker Model is a concept that shows how the market moves when trying to deliver price in one direction.'
      },
      { kind: 'subhead', text: 'A Market Maker Model (MMXM) consists of:' },
      {
        kind: 'list',
        items: [
          'Consolidation phases',
          'Distribution phases (when price is moving in the direction of the bias)',
          'Reversal phase (when the market changes its overall direction and bias, i.e. from bullish to bearish)'
        ]
      },
      {
        kind: 'p',
        text: 'It consists of an original consolidation, then a distribution move respective to the bias, then another consolidation, and another distribution move. That continues happening until certain conditions and confluences are made that can indicate the market\u2019s intention of a reversal.'
      },
      {
        kind: 'p',
        text: 'Once the reversal is made (confirmed with concepts we talk about later called Quarterly Theory), the market begins to distribute in the opposing direction, then makes a new consolidation, then again continues the distribution in the new direction, until the original consolidation\u2019s high/low made at the beginning of the MMXM is taken out.'
      }
    ]
  },
  {
    id: 'smts',
    title: 'SMTs',
    blurb: 'SMT Divergence - when correlated markets stop moving the same.',
    cover: smtsCover,
    body: [
      {
        kind: 'p',
        text: 'SMT Divergence is when correlated markets that usually move in the same direction stop moving the same.'
      },
      {
        kind: 'p',
        text: 'This can be seen with highs and lows being swept on one asset, whilst the other asset performs a failure swing of that same high/low.'
      }
    ]
  },
  {
    id: 'tpds',
    title: 'TPDs',
    blurb: 'Time & Price Delivery - covered in the private mentorship.',
    mentorshipOnly: true,
    body: [{ kind: 'p', text: MENTORSHIP_NOTE }]
  },
  {
    id: 'ssmts',
    title: 'SSMTs',
    blurb: 'Covered in the private mentorship.',
    mentorshipOnly: true,
    body: [{ kind: 'p', text: MENTORSHIP_NOTE }]
  },
  {
    id: 'points-theory',
    title: 'Points Theory',
    blurb: 'Covered in the private mentorship.',
    mentorshipOnly: true,
    body: [{ kind: 'p', text: MENTORSHIP_NOTE }]
  }
]
