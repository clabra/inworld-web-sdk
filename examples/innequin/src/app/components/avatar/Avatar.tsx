import { AdditionalPhonemeInfo, EmotionEvent } from '@inworld/web-sdk';
import { Box, Divider, Stack } from '@mui/material';
import { AnimationFile, ANIMATION_TYPE, EMOTIONS, EMOTIONS_FACE } from '../../types';

import { useCallback, useEffect, useState } from "react";

import Scene from './Scene';

interface AvatarProps {
  animationFiles: AnimationFile[];
  animationSequence: string[];
  emotion: EMOTIONS;
  emotionEvent?: EmotionEvent;
  emotionFace: EMOTIONS_FACE;
  phonemes: AdditionalPhonemeInfo[];
  visible: boolean;
  url: string;
}

export function Avatar(props: AvatarProps) {

  return (
    <Stack
      className="avatar"
      direction="row"
      divider={<Divider orientation="vertical" flexItem />}
      spacing={1}
      sx={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
        display: props.visible ? 'flex' : 'none',
        zIndex: '1',
      }}
    >
      <Box
        sx={{
          borderRadius: '1.75rem',
          backgroundColor: '#303030',
          width: '100%',
          height: '100%',
        }}
      >
        <Scene 
          url={props.url} 
          emotion={props.emotion} 
          emotionFace={props.emotionFace}
          animationFiles={props.animationFiles} 
          animationSequence={props.animationSequence}
          emotionEvent={props.emotionEvent}
          phonemes={props.phonemes}
        />
      </Box>
    </Stack>
  );
}