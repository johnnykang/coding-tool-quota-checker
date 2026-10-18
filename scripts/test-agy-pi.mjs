import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../au.jkang.codingtoolquotachecker.sdPlugin/pi-agy-quota.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const buckets = [
    { id: 'gemini-5h', group: 'Gemini', window: '5h', name: 'Five hours' },
    { id: 'gemini-weekly', group: 'Gemini', window: 'weekly', name: 'Weekly' },
    { id: 'gemini-argon-wtu-weekly', group: 'Gemini 4 Argon', window: 'weekly', name: 'Argon weekly' }
];

function open(settings = {}) {
    const elements = Object.fromEntries(['bucketId', 'displayMode', 'bucketStatus', 'displayValue', 'saveButton', 'status'].map(id => [id, {
        value: '', options: [], innerText: '',
        replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; },
        add(option) { this.options.push(option); },
        addEventListener(event, handler) { this[event] = handler; }
    }]));
    let socket;
    const context = vm.createContext({
        document: { getElementById: id => elements[id] },
        Option: class { constructor(text, value) { this.text = text; this.value = value; } },
        WebSocket: class {
            constructor() { socket = this; this.sent = []; }
            send(value) { this.sent.push(JSON.parse(value)); }
        },
        setTimeout() {}
    });
    vm.runInContext(script, context);
    context.connectElgatoStreamDeckSocket(1234, 'button-context', 'registerPropertyInspector', '{}', JSON.stringify({ action: 'au.jkang.codingtoolquotachecker.agy' }));
    socket.onopen();
    const receive = (event, payload) => socket.onmessage({ data: JSON.stringify({ event, payload }) });
    receive('didReceiveSettings', { settings });
    return { elements, socket, receive };
}

const panel = open({ bucketId: 'gemini-5h', displayMode: 'quota' });
assert.equal(panel.socket.sent[0].event, 'registerPropertyInspector');
assert.equal(panel.socket.sent[1].event, 'getSettings');
assert.equal(panel.socket.sent[2].payload.type, 'getAgyBuckets');
assert.equal(panel.socket.sent[2].context, 'button-context');
panel.receive('sendToPropertyInspector', { type: 'agyBuckets', buckets });
assert.equal(panel.elements.bucketId.options.length, 4);
assert.equal(panel.elements.bucketId.value, 'gemini-5h');
assert.match(panel.elements.bucketId.options[3].text, /Argon.*weekly/);
panel.elements.bucketId.value = 'gemini-weekly';
panel.elements.displayMode.value = 'aiCredits';
panel.elements.saveButton.click();
assert.deepEqual(panel.socket.sent.at(-1), {
    event: 'setSettings', context: 'button-context', payload: { bucketId: 'gemini-weekly', displayMode: 'aiCredits' }
});
assert.equal(panel.socket.sent.filter(message => message.payload?.type === 'refreshAgy').length, 0);

const delayed = open({ bucketId: 'gemini-5h' });
delayed.elements.bucketId.value = '';
delayed.receive('sendToPropertyInspector', { type: 'agyBuckets', buckets });
assert.equal(delayed.elements.bucketId.value, '', 'late quota response preserves unsaved Automatic selection');

const missing = open({ bucketId: 'retired-weekly' });
missing.receive('sendToPropertyInspector', { type: 'agyBuckets', buckets });
assert.equal(missing.elements.bucketId.value, 'retired-weekly');
assert.equal(missing.elements.bucketId.options.at(-1).text, 'Unavailable: retired-weekly');
missing.receive('sendToPropertyInspector', { type: 'agyBuckets', error: 'AGY is unavailable.' });
assert.equal(missing.elements.bucketId.value, 'retired-weekly');
assert.equal(missing.elements.bucketStatus.innerText, 'AGY is unavailable.');
missing.receive('sendToPropertyInspector', { type: 'updateDisplay', value: '20% used / 80% remaining' });
assert.equal(missing.elements.displayValue.innerText, '20% used / 80% remaining');

console.log('AGY Property Inspector options, delayed response and save checks passed.');
