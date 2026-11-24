"use client";

// 3D meeting room (three.js). The buying committee sits across the table from
// the seller (the camera). Every decision is acted out by the characters:
// posture, gestures, who they turn to, and walking out of the room.
// Labels are DOM elements (CSS2DRenderer) filled with textContent only, since
// they show model output.
import { ACTION_ICON, firstName, hasLeft, type Member, type MemberState } from "@/lib/committee";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

export type Room3DProps = {
  members: Member[];
  states: Record<string, MemberState>;
  deltas: Record<string, { interest: number; trust: number } | null>;
  speakingId: string | null;
  lastLines: Record<string, string>;
  reveal: boolean;
  t: Dictionary;
  onError: () => void;
};

const SHIRTS = [0x5b4cf0, 0x0f766e, 0xd48a00];
const SKINS = [0xe0b48f, 0xc68863, 0x8d5a3b];
const HAIR = [0x2b1d14, 0x111111, 0x5a3a22];
const MOOD = { good: 0x12a150, warn: 0xd48a00, bad: 0xd9363e };
const DOOR = new THREE.Vector3(3.6, 0, -2.4);

type Rig = {
  member: Member;
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  phone: THREE.Mesh;
  notepad: THREE.Mesh;
  ring: THREE.Mesh;
  seat: THREE.Vector3;
  /** Above the head: speech bubble and whisper. */
  label: HTMLElement;
  /** On the table in front of them: name, action and meters. */
  card: HTMLElement;
  fade: number;
};

function moodColor(interest: number) {
  return interest >= 60 ? MOOD.good : interest >= 35 ? MOOD.warn : MOOD.bad;
}

function el(tag: string, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildCharacter(index: number) {
  const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, transparent: true });
  const root = new THREE.Group();

  // The chair is separate furniture: it stays when the buyer walks out.
  const furniture = new THREE.Group();
  const chair = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.6), mat(0x3a3a4a));
  chair.position.set(0, 0.5, 0.05);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.08), mat(0x3a3a4a));
  back.position.set(0, 0.95, -0.28);
  furniture.add(chair, back);

  // Torso pivots at the hips so leaning looks natural.
  const torso = new THREE.Group();
  torso.position.set(0, 0.55, 0);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.45, 6, 12), mat(SHIRTS[index % SHIRTS.length]));
  body.position.y = 0.42;
  torso.add(body);

  const head = new THREE.Group();
  head.position.y = 0.98;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 16), mat(SKINS[index % SKINS.length]));
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2.2),
    mat(HAIR[index % HAIR.length]),
  );
  hair.position.y = 0.02;
  const eyeGeo = new THREE.SphereGeometry(0.025, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, mat(0x111111));
  const eyeR = new THREE.Mesh(eyeGeo, mat(0x111111));
  eyeL.position.set(-0.07, 0.02, 0.18);
  eyeR.position.set(0.07, 0.02, 0.18);
  head.add(skull, hair, eyeL, eyeR);
  torso.add(head);

  // Arms pivot at the shoulders.
  const arm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(0.3 * side, 0.72, 0);
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.4, 4, 8), mat(SHIRTS[index % SHIRTS.length]));
    limb.position.y = -0.24;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat(SKINS[index % SKINS.length]));
    hand.position.y = -0.48;
    g.add(limb, hand);
    torso.add(g);
    return g;
  };
  const armL = arm(-1);
  const armR = arm(1);

  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.015), mat(0x111122));
  phone.position.set(0, -0.5, 0.06);
  armR.add(phone);
  const notepad = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.22), mat(0xfafafa));
  notepad.position.set(0, 0.83, 0.62);
  root.add(notepad);

  // Glow ring on the floor: colour = interest, brighter while speaking.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.52, 40),
    new THREE.MeshBasicMaterial({ color: MOOD.warn, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  root.add(ring, torso);

  return { root, furniture, torso, head, armL, armR, phone, notepad, ring };
}

const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

export function Room3D(props: Room3DProps) {
  const mount = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const rigs = useRef<Rig[]>([]);

  useEffect(() => {
    latest.current = props;
  });

  // Build the scene once per committee.
  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      latest.current.onError();
      return;
    }
    const width = () => host.clientWidth || 600;
    const height = () => host.clientHeight || 320;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width(), height());
    renderer.shadowMap.enabled = true;
    host.appendChild(renderer.domElement);

    const labels = new CSS2DRenderer();
    labels.setSize(width(), height());
    labels.domElement.style.position = "absolute";
    labels.domElement.style.inset = "0";
    labels.domElement.style.pointerEvents = "none";
    host.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, width() / height(), 0.1, 50);
    camera.position.set(0, 2.55, 4.3);
    camera.lookAt(0, 1.15, -0.9);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8888aa, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 5, 3);
    sun.castShadow = true;
    scene.add(sun);

    // Room: floor, back wall with a window, door, table.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 10), new THREE.MeshStandardMaterial({ color: 0xd9d6e8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 4), new THREE.MeshStandardMaterial({ color: 0xeeebff }));
    wall.position.set(0, 2, -2.8);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.3), new THREE.MeshBasicMaterial({ color: 0xbfe3ff }));
    win.position.set(-1.6, 2.1, -2.79);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.9), new THREE.MeshStandardMaterial({ color: 0x8a6a4a }));
    door.position.set(DOOR.x, 0.95, -2.78);
    // A long boardroom table between the seller (camera) and the committee.
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5c44, roughness: 0.5 });
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.08, 1.1), wood);
    tableTop.position.set(0, 0.78, 0.05);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    scene.add(floor, wall, win, door, tableTop);
    for (const x of [-2.9, 2.9]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.78, 0.9), new THREE.MeshStandardMaterial({ color: 0x4a3a2c }));
      leg.position.set(x, 0.39, 0.05);
      scene.add(leg);
    }

    // Seat the committee in an arc on the far side of the table.
    const members = latest.current.members;
    const n = members.length;
    rigs.current = members.map((member, i) => {
      const { furniture, ...c } = buildCharacter(i);
      const spread = n === 1 ? 0 : (i / (n - 1) - 0.5) * (n === 2 ? 2.8 : 4.6);
      const seat = new THREE.Vector3(spread, 0, -0.85);
      c.root.position.copy(seat);
      furniture.position.copy(seat);
      c.root.traverse((o) => (o.castShadow = true));
      scene.add(furniture, c.root);

      const label = el("div", "room3d-label");
      const anchor = new CSS2DObject(label);
      // Bottom edge just above the character's head.
      anchor.center.set(0.5, 1);
      anchor.position.set(0, 1.85, 0);
      c.root.add(anchor);

      // The card sits on the front edge of the table, in the scene (not on
      // the character) so it stays put when they walk out.
      const card = el("div", "room3d-card");
      const cardAnchor = new CSS2DObject(card);
      cardAnchor.center.set(0.5, 0.5);
      cardAnchor.position.set(seat.x, 0.84, 0.3);
      scene.add(cardAnchor);
      return { member, ...c, seat, label, card, fade: 1 };
    });

    const resize = new ResizeObserver(() => {
      renderer.setSize(width(), height());
      labels.setSize(width(), height());
      camera.aspect = width() / height();
      camera.updateProjectionMatrix();
    });
    resize.observe(host);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clock = new THREE.Clock();
    let frame = 0;
    const tick = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const time = clock.elapsedTime;
      const { states, speakingId } = latest.current;
      for (const [i, rig] of rigs.current.entries()) {
        const s = states[rig.member.id];
        if (!s) continue;
        animateRig(rig, s, i, rigs.current, speakingId === rig.member.id, time, dt, reduced);
      }
      renderer.render(scene, camera);
      labels.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.Material | THREE.Material[];
          (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
        }
      });
      renderer.dispose();
      host.replaceChildren();
      rigs.current = [];
    };
    // The scene is rebuilt only when the committee itself changes.
  }, [props.members]);

  // Refresh the DOM labels when state changes.
  useEffect(() => {
    for (const rig of rigs.current) {
      const s = props.states[rig.member.id];
      if (s) renderLabel(rig, s, props);
    }
  });

  return <div ref={mount} className="relative h-80 w-full overflow-hidden rounded-xl bg-accent-soft/40" />;
}

function animateRig(
  rig: Rig,
  s: MemberState,
  index: number,
  all: Rig[],
  speaking: boolean,
  time: number,
  dt: number,
  reduced: boolean,
) {
  const wave = (speed: number, amount: number) => (reduced ? 0 : Math.sin(time * speed + index) * amount);
  let lean = 0;
  let headPitch = 0;
  let headYaw = 0;
  let turn = 0;
  let armLx = 0.25;
  let armRx = 0.25;
  let armLz = 0.15;
  let armRz = -0.15;
  let phone = false;
  let notes = false;

  switch (s.action) {
    case "leans_in":
    case "ready_to_buy":
      lean = 0.32;
      armLx = armRx = 1.1;
      break;
    case "takes_notes":
      lean = 0.2;
      headPitch = 0.35;
      armRx = 1.2;
      notes = true;
      break;
    case "nods":
      headPitch = 0.12 + wave(7, 0.18);
      break;
    case "checks_phone":
      headPitch = 0.55;
      armRx = 1.3;
      armRz = 0.25;
      phone = true;
      break;
    case "crosses_arms":
      lean = -0.18;
      armLx = armRx = 1.35;
      armLz = -0.9;
      armRz = 0.9;
      break;
    case "pushes_back":
      lean = -0.12;
      headYaw = wave(9, 0.25);
      armRx = 1.6;
      break;
    case "whispers_to_colleague": {
      const neighbour = all[index + 1] ?? all[index - 1];
      turn = neighbour ? (neighbour.seat.x > rig.seat.x ? 0.7 : -0.7) : 0;
      lean = 0.1;
      break;
    }
  }

  // Face whoever they're talking to: a colleague, or the seller (camera).
  if (s.addressedTo !== "seller" && s.action !== "whispers_to_colleague") {
    const target = all.find((r) => firstName(r.member.name).toLowerCase() === s.addressedTo.toLowerCase());
    if (target) turn = target.seat.x > rig.seat.x ? 0.6 : -0.6;
  }
  if (speaking) {
    headPitch += wave(10, 0.06);
    lean += 0.06;
  }

  rig.torso.rotation.x = damp(rig.torso.rotation.x, lean, 6, dt);
  rig.torso.rotation.y = damp(rig.torso.rotation.y, turn, 5, dt);
  rig.head.rotation.x = damp(rig.head.rotation.x, headPitch, 8, dt);
  rig.head.rotation.y = damp(rig.head.rotation.y, headYaw + turn * 0.3, 8, dt);
  rig.armL.rotation.x = damp(rig.armL.rotation.x, armLx, 6, dt);
  rig.armR.rotation.x = damp(rig.armR.rotation.x, armRx, 6, dt);
  rig.armL.rotation.z = damp(rig.armL.rotation.z, armLz, 6, dt);
  rig.armR.rotation.z = damp(rig.armR.rotation.z, armRz, 6, dt);
  rig.phone.visible = phone;
  rig.notepad.visible = notes;

  const ring = rig.ring.material as THREE.MeshBasicMaterial;
  ring.color.setHex(moodColor(s.interest));
  ring.opacity = damp(ring.opacity, speaking ? 0.95 : 0.45, 6, dt);

  // Walking out: stand up, head to the door, fade away.
  if (hasLeft(s)) {
    const pos = rig.root.position;
    pos.x = damp(pos.x, DOOR.x, 1.2, dt);
    pos.z = damp(pos.z, DOOR.z, 1.2, dt);
    rig.root.rotation.y = damp(rig.root.rotation.y, Math.atan2(DOOR.x - pos.x, DOOR.z - pos.z), 4, dt);
    rig.torso.position.y = damp(rig.torso.position.y, 0.75, 4, dt);
    if (pos.distanceTo(DOOR) < 0.6) rig.fade = Math.max(0, rig.fade - dt);
    rig.root.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).opacity = rig.fade;
    });
    rig.label.style.opacity = String(rig.fade);
    rig.card.style.opacity = "0.55";
  }
}

function renderLabel(rig: Rig, s: MemberState, props: Room3DProps) {
  const { t, deltas, speakingId, lastLines, reveal } = props;
  const box = rig.label;
  box.replaceChildren();
  const left = hasLeft(s);
  const line = lastLines[rig.member.id];
  if (reveal && s.whisper && !left) box.append(el("div", "room3d-whisper", `🤫 ${s.whisper}`));
  if (line && !left) {
    box.append(el("div", `room3d-bubble${speakingId === rig.member.id ? " is-speaking" : ""}`, line));
  }
  const card = rig.card;
  card.replaceChildren();
  const name = el("div", "room3d-name", rig.member.name);
  if (rig.member.memory) {
    const badge = el("span", "room3d-memory", "🧠");
    badge.title = t.room.remembers;
    badge.setAttribute("aria-label", t.room.remembers);
    name.append(badge);
  }
  card.append(name, el("div", "room3d-action", `${ACTION_ICON[s.action]} ${left ? t.room.left : t.actions[s.action]}`));
  const d = deltas[rig.member.id];
  for (const [label, value, delta] of [
    [t.room.interest, s.interest, d?.interest],
    [t.room.trust, s.trust, d?.trust],
  ] as const) {
    const row = el("div", "room3d-meter");
    row.append(el("span", "", label));
    const bar = el("span", "room3d-bar");
    const fill = el("span", "room3d-fill");
    fill.style.width = `${value}%`;
    fill.style.background = `#${moodColor(value).toString(16).padStart(6, "0")}`;
    bar.append(fill);
    row.append(bar, el("span", "room3d-num", delta ? `${value} ${delta > 0 ? "+" : ""}${delta}` : String(value)));
    card.append(row);
  }
}
