import Phaser from 'phaser';
import { COLORS, textStyle } from './theme';

export interface ButtonOptions {
  width?: number;
  height?: number;
  fontSize?: number;
  onClick: () => void;
}

/** Rounded-rect text button, origin at its centre. */
export class Button extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly bw: number;
  private readonly bh: number;
  private enabled = true;

  constructor(scene: Phaser.Scene, x: number, y: number, label: string, opts: ButtonOptions) {
    super(scene, x, y);
    this.bw = opts.width ?? 260;
    this.bh = opts.height ?? 48;
    this.bg = scene.add.graphics();
    const text = scene.add.text(0, 0, label, textStyle(opts.fontSize ?? 18)).setOrigin(0.5);
    this.add([this.bg, text]);
    this.draw(COLORS.panelLight);

    this.setSize(this.bw, this.bh);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => this.enabled && this.draw(COLORS.border));
    this.on('pointerout', () => this.enabled && this.draw(COLORS.panelLight));
    this.on('pointerup', () => this.enabled && opts.onClick());
    scene.add.existing(this);
  }

  setEnabled(on: boolean): this {
    this.enabled = on;
    this.setAlpha(on ? 1 : 0.45);
    this.draw(COLORS.panelLight);
    return this;
  }

  private draw(fill: number): void {
    this.bg.clear();
    this.bg.fillStyle(fill, 1).fillRoundedRect(-this.bw / 2, -this.bh / 2, this.bw, this.bh, 8);
    this.bg.lineStyle(1, COLORS.border, 1).strokeRoundedRect(-this.bw / 2, -this.bh / 2, this.bw, this.bh, 8);
  }
}
