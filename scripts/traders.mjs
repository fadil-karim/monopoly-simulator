// A table of traders for the checks: every so often a player offers one of its properties for one of a rival's,
// sometimes one it does not own (refused by the rules); the other side accepts, rejects or counters, sometimes with
// a counter the rules refuse; every other decision is the rule-based player's. No model is called. With `flaky`
// (a share of the answers), an answer now and then fails as a model's can: a call that throws, one the AI layer
// reports as failed, no answer, an empty one, or one of the wrong shape, so every forfeit is exercised.
import { mulberry32 } from '../public/assets/app/engine.js';
import { heuristicDecide } from '../public/assets/app/heuristics.js';

const BAD = [
  () => { throw new Error('simulated timeout'); },
  () => ({ __forfeit: 'error', __error: 'fetch failed: other side closed', __call: 0 }),
  () => null,
  () => ({ __forfeit: 'empty', __error: 'empty reply' }),
  () => ({ buy: 'yes', bid: 'lots', accept: 'maybe', actions: 'build everything', space: 'anywhere', property: 'that one' }),
];

export function traders(seed, { flaky = 0 } = {}) {
  const rnd = mulberry32(seed);
  const pick = (arr) => (arr.length ? [arr[Math.floor(rnd() * arr.length)]] : []);
  const answer = async (args) => {
    if (flaky && rnd() < flaky) return BAD[Math.floor(rnd() * BAD.length)]();
    return (await play(args)) || heuristicDecide(args.game, args.player, args.type, args.ctx);
  };
  const play = async ({ game, player: p, type, ctx }) => {
    if (type === 'preroll') {
      const h = heuristicDecide(game, p, 'preroll', ctx);
      const others = game.alive().filter((o) => o.id !== p.id);
      if (!others.length || rnd() > 0.4) return h;
      const o = others[Math.floor(rnd() * others.length)];
      const free = (q) => game.ownedBy(q).filter((i) => game.props[i].level === 0);
      let give = pick(free(p));
      const get = pick(free(o));
      if (rnd() < 0.12) give = pick(game.ownedBy(o)); // not the proposer's to give
      const a = { type: 'propose_trade', to: rnd() < 0.5 ? o.id : o.name, give: { properties: give, cash: rnd() < 0.4 ? Math.floor(rnd() * Math.min(p.cash, 200)) : 0 }, get: { properties: get, cash: rnd() < 0.3 ? Math.floor(rnd() * Math.min(o.cash, 150)) : 0 }, message: 'How about this?' };
      return { ...h, actions: [a, ...(h.actions || [])] };
    }
    if (type === 'trade_response') {
      const x = rnd(), o = ctx.offer;
      if (x < 0.3) return { accept: true, reason: 'agreed' };
      if (x < 0.7) {
        const give = rnd() < 0.08 ? [9999] : o.get.props.slice();
        return { accept: false, counter: { give: { properties: give, cash: 0 }, get: { properties: o.give.props.slice(), cash: Math.floor(rnd() * 60) }, message: 'Closer.' }, reason: 'counter' };
      }
      return { accept: false, reason: 'no thanks' };
    }
    return null;
  };
  return { decide: answer };
}
