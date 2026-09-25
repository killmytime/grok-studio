import { describe, it, expect } from 'vitest';
import { buildResponsesInput, noticesFromResponsesPayload, storedImageCall } from '../app/lib/chat-images';
import { nearestAspect, resolutionFromPixels } from '../app/lib/image-presets';

describe('responses image events', () => {
  it('reads text, status, and the finished image without treating the base64 as text', () => {
    const notices = noticesFromResponsesPayload(JSON.stringify({
      type: 'response.output_item.done',
      item: {
        type: 'image_generation_call',
        id: 'ie_edit',
        status: 'completed',
        prompt: 'night lighthouse',
        result: 'AAAA',
      },
    }));
    expect(notices).toEqual([
      { type: 'image', item: expect.objectContaining({ id: 'ie_edit', prompt: 'night lighthouse' }) },
    ]);
    const call = storedImageCall((notices[0] as any).item, 'img-1');
    expect(call.result).toBeUndefined();
    expect(call.image_id).toBe('img-1');
    expect(call.prompt).toBe('night lighthouse');
  });

  it('maps pixels onto the gallery aspect and resolution labels', () => {
    expect(nearestAspect(1920, 1080)).toBe('16:9');
    expect(nearestAspect(1080, 1920)).toBe('9:16');
    expect(resolutionFromPixels(512, 512)).toBe('512');
    expect(resolutionFromPixels(1024, 1024)).toBe('1k');
    expect(resolutionFromPixels(2048, 1152)).toBe('2k');
  });

  it('sends back only the most recent image calls, with bytes rehydrated from disk ids', () => {
    const calls = (id: string, imageId: string) => ({
      extra_json: { image_calls: [{ id, image_id: imageId, prompt: id, status: 'completed' }] },
    });
    const msgs = [
      { role: 'user', content: 'one', status: 'completed' },
      { role: 'assistant', content: 'a1', status: 'completed', ...calls('ig_1', 'img-1') },
      { role: 'user', content: 'two', status: 'completed' },
      { role: 'assistant', content: '', status: 'completed', ...calls('ig_2', 'img-2') },
      { role: 'user', content: 'three', status: 'completed' },
      { role: 'assistant', content: 'a3', status: 'completed', ...calls('ig_3', 'img-3') },
      { role: 'user', content: 'four', status: 'completed' },
      { role: 'assistant', content: 'a4', status: 'completed', ...calls('ig_4', 'img-4') },
      { role: 'user', content: 'five', status: 'completed' },
      { role: 'assistant', content: 'a5', status: 'completed', ...calls('ig_5', 'img-5') },
    ];
    const input = buildResponsesInput(msgs, null, (imageId) => `bytes-${imageId}`, 2) as Array<Record<string, any>>;
    const images = input.filter((item) => item.type === 'image_generation_call');
    expect(images.map((item: any) => item.id)).toEqual(['ig_4', 'ig_5']);
    expect(images[0].result).toBe('bytes-img-4');
    expect(images.every((item: any) => item.image_id == null)).toBe(true);
    expect(input.some((item: any) => item.type === 'message' && item.content?.[0]?.text === 'a5')).toBe(true);
    expect(input.some((item: any) => item.role === 'user' && item.content === 'five')).toBe(true);
  });
});
