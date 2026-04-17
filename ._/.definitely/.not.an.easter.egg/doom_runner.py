"""DOOM easter egg — standalone pygame launcher using cydoomgeneric."""

import sys
import numpy as np
import pygame
import cydoomgeneric as cdg

KEYMAP = {
    pygame.K_LEFT: cdg.Keys.LEFTARROW,
    pygame.K_RIGHT: cdg.Keys.RIGHTARROW,
    pygame.K_UP: cdg.Keys.UPARROW,
    pygame.K_DOWN: cdg.Keys.DOWNARROW,
    pygame.K_COMMA: cdg.Keys.STRAFE_L,
    pygame.K_PERIOD: cdg.Keys.STRAFE_R,
    pygame.K_LCTRL: cdg.Keys.FIRE,
    pygame.K_RCTRL: cdg.Keys.FIRE,
    pygame.K_SPACE: cdg.Keys.USE,
    pygame.K_LSHIFT: cdg.Keys.RSHIFT,
    pygame.K_RSHIFT: cdg.Keys.RSHIFT,
    pygame.K_RETURN: cdg.Keys.ENTER,
    pygame.K_ESCAPE: cdg.Keys.ESCAPE,
    pygame.K_TAB: cdg.Keys.TAB,
}

RESX, RESY = 640, 400

if len(sys.argv) < 2:
    sys.exit("Usage: doom_runner.py <WAD path>")

pygame.init()
screen = pygame.display.set_mode((RESX, RESY))
pygame.display.set_caption("DOOM")


def draw_frame(pixels):
    pygame.surfarray.blit_array(screen, np.flipud(np.rot90(pixels))[:, :, [2, 1, 0]])
    pygame.display.flip()


def get_key():
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            sys.exit()
        if event.type == pygame.KEYDOWN and event.key in KEYMAP:
            return 1, KEYMAP[event.key]
        if event.type == pygame.KEYUP and event.key in KEYMAP:
            return 0, KEYMAP[event.key]
    return None


def set_title(t):
    pygame.display.set_caption(t)


cdg.init(RESX, RESY, draw_frame, get_key, set_window_title=set_title)
cdg.main(argv=["doom", "-iwad", sys.argv[1]])
