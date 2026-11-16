import { useEffect, useRef, useState } from 'react';
import { dragHasFiles } from '../../../lib/mediaLibraryUploads.ts';

/**
 * Files dragged from the computer onto the window, wherever they are let go: over the list,
 * the header, the sidebar or an open dialog. Returns true while such a drag is over the
 * window, so the page can show where the files will go.
 *
 * Every file drag is taken, also when `onFiles` then decides to ignore it: a file dropped on
 * a page that does not take it makes the browser leave the portal and open the file.
 * Text, links and elements being dragged are left alone.
 */
export function useFileDrop(onFiles: (files: readonly File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const handler = useRef(onFiles);
  useEffect(() => {
    handler.current = onFiles;
  }, [onFiles]);

  useEffect(() => {
    // Enter and leave fire for every element the pointer crosses; the drag is over the
    // window while more have been entered than left.
    let depth = 0;
    const carriesFiles = (event: DragEvent) => dragHasFiles(event.dataTransfer?.types);

    const onEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) handler.current(files);
    };
    const onEnd = () => {
      depth = 0;
      setDragging(false);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onEnd);
    window.addEventListener('blur', onEnd);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onEnd);
      window.removeEventListener('blur', onEnd);
    };
  }, []);

  return dragging;
}
