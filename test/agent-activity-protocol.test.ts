import {expect,it} from 'vitest';
import {parseHostToWebviewMessage} from '../packages/core/src/editorProtocol';
it('validates versioned activity snapshots including nested task projections', () => {
 const message = {command:'agent-activity',panelId:'A',generation:1,documentVersion:2,sequence:1,content:'- [ ] X',summary:'A working',tasks:[{line:0,expectedLineText:'- [ ] X',state:'working',producerLabel:'A'}]};
 expect(parseHostToWebviewMessage(message).kind).toBe('message');
 for(const patch of [{sequence:-1},{generation:NaN},{tasks:[{...message.tasks[0],line:-1}]},{tasks:[{...message.tasks[0],state:'done'}]},{tasks:[null]}]) expect(parseHostToWebviewMessage({...message,...patch}).kind).toBe('malformed');
});
