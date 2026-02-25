import { useState } from 'react';
import {
  XCircle,
} from 'lucide-react';

interface BlendPreviewProps {
  blendId: string;
}

export function BlendPreview({ blendId }: BlendPreviewProps) {
  return (
    <div className="flex items-center justify-center h-full text-muted-foreground text-sm text-center px-8">
      <div>
        <XCircle className="w-8 h-8 opacity-20 mx-auto mb-3" />
        <p className="font-medium text-foreground/60 mb-1">No blend preview available</p>
        <p className="text-xs leading-relaxed">
          Select a blend suggestion to see a preview of the joined data.
          Blend suggestions will appear once table relationships are detected.
        </p>
      </div>
    </div>
  );
}
