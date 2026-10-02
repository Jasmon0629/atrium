import { useEffect, useRef, useState } from 'react';
import { toast } from '../stores/ui';

/**
 * Voice-to-text via the Web Speech API (Chrome/Edge). `supported` is false on
 * browsers without it, so callers can hide the mic button entirely. Final
 * phrases go to `onText`; `interim` holds the live partial transcript so the
 * UI can show words as they are recognised.
 */
export function useSpeechToText(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const recRef = useRef<any>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const SR =
    typeof window !== 'undefined' &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const supported = !!SR;

  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {}
    };
  }, []);

  function start() {
    if (!SR || listening) return;
    const rec = new SR();
    recRef.current = rec;
    rec.lang = navigator.language || 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let finalText = '';
      let partial = '';
      for (const r of Array.from(e.results) as any[]) {
        const t = r[0]?.transcript || '';
        if (r.isFinal) finalText += t;
        else partial += t;
      }
      setInterim(partial.trim());
      if (finalText.trim()) onTextRef.current(finalText.trim());
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
    };
    rec.onerror = (e: any) => {
      setListening(false);
      setInterim('');
      const code = e?.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        toast({ kind: 'error', title: 'Microphone blocked', body: 'Allow microphone access for this site to dictate messages.' });
      } else if (code && code !== 'aborted' && code !== 'no-speech') {
        toast({ kind: 'error', title: 'Voice input failed', body: `Speech recognition error: ${code}` });
      }
    };
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  function stop() {
    try {
      recRef.current?.stop();
    } catch {}
    setListening(false);
    setInterim('');
  }

  return { supported, listening, interim, start, stop };
}
