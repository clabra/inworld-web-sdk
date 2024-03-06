import { InworldConnectionService, InworldTriggers } from '@inworld/web-core';
import {
  AddReaction,
  MoreVert,
  MovieFilter,
  PersonAddAlt1,
  Send,
  Start,
} from '@mui/icons-material';
import {
  Box,
  Dialog,
  DialogContent,
  IconButton,
  InputAdornment,
  Popover,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material';
import React, { useCallback, useState } from 'react';

import { INWORLD_COLORS } from '../helpers/colors';
import { CHAT_VIEW } from '../types';

export interface AdditionalActionsProps {
  onClose: () => void;
  chatView: CHAT_VIEW;
  connection: InworldConnectionService;
  playWorkaroundSound: () => void;
}

export const AdditionalActions = (props: AdditionalActionsProps) => {
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [narration, setNarration] = useState('');
  const [narratedActionDialogOpen, setNarratedActionDialogOpen] =
    useState(false);
  const [sceneName, setSceneName] = useState('');
  const [characterName, setCharacterName] = useState('');
  const [changeSceneDialogOpen, setChangeSceneDialogOpen] = useState(false);
  const [addCharacterDialogOpen, setAddCharacterDialogOpen] = useState(false);

  const onOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
    setEl(event.currentTarget);
  };

  const onClose = () => {
    setEl(null);
  };

  const handleNarrationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setNarration(e.target.value);
    },
    [],
  );

  const handleNarratedActionDialog = useCallback(() => {
    setNarratedActionDialogOpen(true);
  }, []);

  const handleSendNarration = useCallback(() => {
    if (narration) {
      props.playWorkaroundSound();

      props.connection?.sendNarratedAction(narration);

      setNarration('');
      setNarratedActionDialogOpen(false);
      onClose();
    }
  }, [props.connection, props.playWorkaroundSound, narration]);

  const handleSceneChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSceneName(e.target.value);
    },
    [],
  );

  const handleSceneChangeDialog = useCallback(() => {
    setChangeSceneDialogOpen(true);
  }, []);

  const handleSendSceneChange = useCallback(async () => {
    if (sceneName) {
      props.playWorkaroundSound();

      await props.connection?.changeScene(sceneName);

      setSceneName('');
      setChangeSceneDialogOpen(false);
      onClose();
    }
  }, [props.connection, props.playWorkaroundSound, sceneName]);

  const handleAddCharacter = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setCharacterName(e.target.value);
    },
    [],
  );

  const handleAddCharacterDialog = useCallback(() => {
    setAddCharacterDialogOpen(true);
  }, []);

  const handleSendAddCharacter = useCallback(async () => {
    if (characterName) {
      props.playWorkaroundSound();

      await props.connection?.addCharacters([characterName]);

      setCharacterName('');
      setAddCharacterDialogOpen(false);
      onClose();
    }
  }, [props.connection, props.playWorkaroundSound, characterName]);

  const handleNextTurn = useCallback(() => {
    props.playWorkaroundSound();

    props.connection?.sendTrigger(InworldTriggers.MUTLI_AGENT_NEXT_TURN);

    setEl(null);
  }, [props.connection, props.playWorkaroundSound]);

  return (
    <>
      <IconButton
        onClick={onOpen}
        size="small"
        sx={{ color: INWORLD_COLORS.warmGray[50] }}
      >
        <MoreVert fontSize="small" />
      </IconButton>

      <Popover
        open={!!el}
        anchorEl={el}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 150,
          horizontal: 'center',
        }}
        onClose={onClose}
      >
        <Stack sx={{ p: 2 }} spacing={2}>
          <Box>
            <Tooltip title="Send narrated action" placement="left">
              <IconButton onClick={handleNarratedActionDialog}>
                <AddReaction fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Change scene" placement="left">
              <IconButton onClick={handleSceneChangeDialog}>
                <MovieFilter fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Add character" placement="left">
              <IconButton onClick={handleAddCharacterDialog}>
                <PersonAddAlt1 fontSize="small" />
              </IconButton>
            </Tooltip>
            {props.chatView === CHAT_VIEW.MULTI_AGENT_TEXT ? (
              <Tooltip title="Next agents turn" placement="left">
                <IconButton onClick={handleNextTurn}>
                  <Start fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : (
              ''
            )}
          </Box>
        </Stack>
      </Popover>

      <Dialog
        open={narratedActionDialogOpen}
        onClose={() => setNarratedActionDialogOpen(false)}
      >
        <DialogContent>
          <Box sx={{ m: 1 }}>
            <TextField
              fullWidth
              size="small"
              label="Narrated action"
              onChange={handleNarrationChange}
              placeholder="Enter action to narrate"
              InputLabelProps={{ shrink: true }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={handleSendNarration}>
                      <Send />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        </DialogContent>
      </Dialog>
      <Dialog
        open={changeSceneDialogOpen}
        onClose={() => setChangeSceneDialogOpen(false)}
      >
        <DialogContent>
          <Box sx={{ m: 1 }}>
            <TextField
              fullWidth
              size="small"
              label="Scene name"
              onChange={handleSceneChange}
              placeholder="Enter scene name"
              InputLabelProps={{ shrink: true }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={handleSendSceneChange}>
                      <Send />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        </DialogContent>
      </Dialog>
      <Dialog
        open={addCharacterDialogOpen}
        onClose={() => setAddCharacterDialogOpen(false)}
      >
        <DialogContent>
          <Box sx={{ m: 1 }}>
            <TextField
              fullWidth
              size="small"
              label="Character name"
              onChange={handleAddCharacter}
              placeholder="Enter character name"
              InputLabelProps={{ shrink: true }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={handleSendAddCharacter}>
                      <Send />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
};
