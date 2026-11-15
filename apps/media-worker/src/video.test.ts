import { describe, expect, it } from 'vitest';
import { judgeProbe, type VideoLimits } from './video.ts';

const limits: VideoLimits = {
  maxVideoWidthPx: 3840,
  maxVideoHeightPx: 2160,
  maxVideoDurationMs: 600_000,
};

/** Shape of `ffprobe -print_format json -show_format -show_streams` for a plain H.264 MP4. */
function probe(
  video: Record<string, unknown> = {},
  extra: Record<string, unknown>[] = [],
  format: Record<string, unknown> = {},
): unknown {
  return {
    streams: [
      {
        index: 0,
        codec_type: 'video',
        codec_name: 'h264',
        profile: 'High',
        pix_fmt: 'yuv420p',
        width: 1920,
        height: 1080,
        duration: '12.480000',
        nb_frames: '312',
        nb_read_packets: '312',
        disposition: { attached_pic: 0 },
        ...video,
      },
      ...extra,
    ],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '12.500000', ...format },
  };
}

describe('judgeProbe', () => {
  it('accepts H.264 4:2:0 in MP4 and reports size, duration and audio presence', () => {
    expect(judgeProbe(probe(), limits)).toEqual({
      ok: true,
      width: 1920,
      height: 1080,
      durationMs: 12_480,
      codec: 'h264',
      hasAudio: false,
    });
    const withAudio = judgeProbe(probe({}, [{ codec_type: 'audio', codec_name: 'aac' }]), limits);
    expect(withAudio).toMatchObject({ ok: true, hasAudio: true });
  });

  it('falls back to the container duration when the stream has none', () => {
    expect(judgeProbe(probe({ duration: undefined }), limits)).toMatchObject({
      ok: true,
      durationMs: 12_500,
    });
  });

  it('reports the displayed size of a rotated video', () => {
    expect(judgeProbe(probe({ side_data_list: [{ rotation: -90 }] }), limits)).toMatchObject({
      ok: true,
      width: 1080,
      height: 1920,
    });
    expect(judgeProbe(probe({ tags: { rotate: '180' } }), limits)).toMatchObject({
      width: 1920,
      height: 1080,
    });
  });

  it.each([
    ['hevc', 'unsupported_codec'],
    ['vp9', 'unsupported_codec'],
    ['av1', 'unsupported_codec'],
    ['mpeg4', 'unsupported_codec'],
  ])('rejects the codec %s', (codec, code) => {
    expect(judgeProbe(probe({ codec_name: codec }), limits)).toMatchObject({ ok: false, code });
  });

  it('rejects pixel formats and profiles that browsers do not reliably decode', () => {
    for (const pix of ['yuv444p', 'yuv422p', 'yuv420p10le']) {
      expect(judgeProbe(probe({ pix_fmt: pix }), limits)).toMatchObject({
        ok: false,
        code: 'unsupported_pixel_format',
      });
    }
    for (const profile of ['High 10', 'High 4:2:2', 'High 4:4:4 Predictive', undefined]) {
      expect(judgeProbe(probe({ profile }), limits)).toMatchObject({
        ok: false,
        code: 'unsupported_pixel_format',
      });
    }
    for (const profile of ['Baseline', 'Constrained Baseline', 'Main', 'High']) {
      expect(judgeProbe(probe({ profile }), limits)).toMatchObject({ ok: true });
    }
  });

  it('rejects containers other than MP4', () => {
    expect(judgeProbe(probe({}, [], { format_name: 'matroska,webm' }), limits)).toMatchObject({
      ok: false,
      code: 'unsupported_type',
    });
    expect(judgeProbe(probe({}, [], { format_name: 'avi' }), limits)).toMatchObject({
      ok: false,
      code: 'unsupported_type',
    });
    expect(judgeProbe(probe({}, [], { format_name: undefined }), limits)).toMatchObject({
      ok: false,
      code: 'unsupported_type',
    });
  });

  it('rejects files without a real video stream', () => {
    expect(
      judgeProbe(
        {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { format_name: 'mov,mp4', duration: '3' },
        },
        limits,
      ),
    ).toMatchObject({ ok: false, code: 'no_video_stream' });
    // Cover art is a "video" stream to ffprobe; it is not a video.
    expect(judgeProbe(probe({ disposition: { attached_pic: 1 } }), limits)).toMatchObject({
      ok: false,
      code: 'no_video_stream',
    });
    expect(
      judgeProbe(
        probe({}, [
          { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 16, height: 16 },
        ]),
        limits,
      ),
    ).toMatchObject({ ok: false, code: 'unsupported_type' });
  });

  it('enforces resolution and duration limits', () => {
    expect(judgeProbe(probe({ width: 7680, height: 4320 }), limits)).toMatchObject({
      ok: false,
      code: 'video_resolution_too_large',
    });
    expect(judgeProbe(probe({ width: 3840, height: 2160 }), limits)).toMatchObject({ ok: true });
    // 2160x3840 portrait exceeds the height limit once the rotation is applied.
    expect(
      judgeProbe(probe({ width: 3840, height: 2160, side_data_list: [{ rotation: 90 }] }), limits),
    ).toMatchObject({ ok: false, code: 'video_resolution_too_large' });
    expect(judgeProbe(probe({ duration: '600.001' }), limits)).toMatchObject({
      ok: false,
      code: 'video_too_long',
    });
    expect(judgeProbe(probe({ duration: '600.000' }), limits)).toMatchObject({
      ok: true,
      durationMs: 600_000,
    });
  });

  it('treats missing or nonsensical structure as corrupt', () => {
    for (const bad of [
      null,
      'text',
      {},
      { streams: 'x', format: {} },
      { streams: [], format: null },
    ]) {
      expect(judgeProbe(bad, limits)).toMatchObject({ ok: false, code: 'corrupt' });
    }
    expect(judgeProbe(probe({ width: 0 }), limits)).toMatchObject({ ok: false, code: 'corrupt' });
    expect(judgeProbe(probe({ width: undefined }), limits)).toMatchObject({
      ok: false,
      code: 'corrupt',
    });
    expect(judgeProbe(probe({ duration: 'N/A' }, [], { duration: 'N/A' }), limits)).toMatchObject({
      ok: false,
      code: 'corrupt',
    });
    expect(judgeProbe(probe({ duration: '-4' }, [], { duration: '0' }), limits)).toMatchObject({
      ok: false,
      code: 'corrupt',
    });
  });

  it('notices media data that is cut short although the index is intact', () => {
    expect(judgeProbe(probe({ nb_read_packets: '150' }), limits)).toMatchObject({
      ok: false,
      code: 'corrupt',
    });
    expect(judgeProbe(probe({ nb_read_packets: '0' }), limits)).toMatchObject({
      ok: false,
      code: 'corrupt',
    });
    expect(judgeProbe(probe({ nb_read_packets: undefined }), limits)).toMatchObject({
      ok: false,
      code: 'corrupt',
    });
    expect(judgeProbe(probe({ pix_fmt: undefined }), limits)).toMatchObject({
      ok: false,
      code: 'corrupt',
    });
    // Fragmented files may declare no frame count; every packet that exists was read.
    expect(judgeProbe(probe({ nb_frames: undefined }), limits)).toMatchObject({ ok: true });
  });

  it('never echoes raw metadata text into the operator-facing detail', () => {
    const verdict = judgeProbe(
      probe({ codec_name: '<script>alert(1)</script>"; rm -rf /' }),
      limits,
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.detail).not.toMatch(/[<>"';/]/);
      expect((verdict.detail ?? '').length).toBeLessThanOrEqual(60);
    }
  });
});
