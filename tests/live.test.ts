// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { subscribeLive, liveClientId } from '../src/live';
let streams: any[];
let cleanup: (() => void)[];
beforeEach(() => {
  streams = []; cleanup = [];
  vi.stubGlobal('EventSource', class { onmessage?: (event: unknown) => void; onopen?: () => void; onerror?: () => void; close = vi.fn(); constructor(public url: string) { streams.push(this); } });
});
afterEach(() => { cleanup.forEach(unsubscribe => unsubscribe()); vi.unstubAllGlobals(); });
it('shares one connection for all channels and closes only after the last subscriber leaves', () => {
  const agent = vi.fn(), library = vi.fn(), reader = vi.fn();
  const offAgent = subscribeLive('agent', agent); cleanup.push(offAgent);
  cleanup.push(subscribeLive('library', library), subscribeLive('reader', reader));
  expect(streams).toHaveLength(1);
  expect(streams[0].url).toContain(`clientId=${liveClientId}`);
  streams[0].onmessage({data:JSON.stringify({type:'agent',data:{revision:2}})});
  streams[0].onmessage({data:JSON.stringify({type:'reader',data:{action:'go_to_page',page:3}})});
  expect(agent).toHaveBeenCalledWith({revision:2});
  expect(reader).toHaveBeenCalledWith({action:'go_to_page',page:3});
  expect(library).not.toHaveBeenCalled();
  offAgent(); expect(streams[0].close).not.toHaveBeenCalled();
  cleanup.forEach(unsubscribe => unsubscribe());
  expect(streams[0].close).toHaveBeenCalledTimes(1);
});
it('replays current display state on remount, never reader commands, and publishes reconnect status', () => {
  const opened = vi.fn(), errored = vi.fn();
  cleanup.push(subscribeLive('agent', () => {}, {onOpen:opened,onError:errored}));
  streams[0].onopen(); streams[0].onerror(); streams[0].onopen();
  expect(opened).toHaveBeenCalledTimes(2); expect(errored).toHaveBeenCalledTimes(1);
  streams[0].onmessage({data:JSON.stringify({type:'agent',data:{revision:7}})});
  streams[0].onmessage({data:JSON.stringify({type:'reader',data:{id:'once'}})});
  const agent = vi.fn(), reader = vi.fn(), newOpen = vi.fn();
  cleanup.push(subscribeLive('agent',agent,{onOpen:newOpen}), subscribeLive('reader',reader));
  expect(agent).toHaveBeenCalledWith({revision:7});
  expect(reader).not.toHaveBeenCalled(); expect(newOpen).toHaveBeenCalledTimes(1);
  expect(streams).toHaveLength(1);
});
