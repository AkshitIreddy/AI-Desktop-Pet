# 🎮 AI Desktop Pet

> **Bring adorable AI-powered companions to your desktop — now alive like never before.**

Tiny animated characters that walk your taskbar, climb your windows, chase your cursor, befriend each other, remember you, and hold real spoken conversations — powered by [Convai](https://convai.com).

[![Latest release](https://img.shields.io/github/v/release/AkshitIreddy/AI-Desktop-Pet?label=release&color=ec4899)](https://github.com/AkshitIreddy/AI-Desktop-Pet/releases/latest)
[![License](https://img.shields.io/badge/license-see%20licenses%2F-8b5cf6)](./licenses)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app)

<p align="center">
  <img src="media/desktop-demo.gif" alt="AI Desktop Pet characters walking the desktop, climbing app windows, and performing actions" width="820">
</p>

---

## ✨ What's new in 2.0

Version 2.0 is a **complete rewrite** — same soul, entirely new body.

- ⚡ **Tauri instead of Electron** — roughly **10× lighter**. One transparent overlay window hosts *all* pets (v1 spawned a full Chromium window per pet), with native Rust handling screen capture, window tracking, and cursor polling.
- 🗣️ **Convai Web SDK 1.6 (beta)** — realtime WebRTC voice conversations, streaming text chat, and dynamic context so characters know what's happening on your desktop.
- 👀 **Screen vision with timed permission grants** — let a character see your screen for a few minutes (countdown badge, auto-revoke, one-shot "take a look"), then it's blind again. Frames are never stored.
- 🧠 **Long-term memory (opt-in)** — characters can remember you across sessions, with an in-app memory journal to browse and delete what they know.
- 🎡 **Radial skill wheel** — click a pet for its wheel of 8 skills, chosen per character from a catalog of **22**: voice, vision, reminders, focus timer, dance party, whisper mode, and more.
- 🐾 **20 ambient behaviors** — including **walking on your app windows**, sitting on window sills, peeking from behind windows, cursor chasing/watching, and **multi-pet friendships**: side-by-side strolls, meet-and-greets, follow-the-leader, mirror dances, taskbar parades.
- ⏰ **Reminders & sticky notes** — your character confirms a reminder when you set it and announces it (voice + native notification) when it's due.
- 🎨 **18 customization options** — themes, accent colors, pet size/opacity, activity level, speech bubble styles, synthesized sound packs, quiet hours, and more.
- 📖 **In-app documentation** — a full illustrated guide lives right inside the dashboard.

<p align="center">
  <img src="media/dashboard-characters.png" alt="The Characters page in the dashboard — toggle a character Active to spawn it on your desktop" width="820">
</p>

---

## 📥 Download

Grab the installer for your OS from the **[latest release](https://github.com/AkshitIreddy/AI-Desktop-Pet/releases/latest)** — one release, every platform:

| Platform | File |
|----------|------|
| 🪟 **Windows** | `Convai-Desktop-Pets_x.x.x_x64-setup.exe` (NSIS installer) |
| 🍎 **macOS** | `Convai-Desktop-Pets_x.x.x.dmg` (Apple Silicon & Intel builds) |
| 🐧 **Linux** | `.deb` package or `.AppImage` |

👉 [View all releases](https://github.com/AkshitIreddy/AI-Desktop-Pet/releases)

---

## 🚀 Quick start

1. **Install and launch** — the dashboard opens; the pet overlay starts quietly in your tray.
2. **Connect Convai** — sign in at [convai.com](https://convai.com), copy your API key from the dashboard (shield icon, top right), and paste it into **Settings → Connection**.
3. **Spawn a character** — flip the **Active** toggle on the Characters page and watch them drop onto your desktop.
4. **Say hello** — click a pet for its skill wheel, or **Alt+click** to chat right away.
5. **Make it yours** — per-character skills, voices, free will, memory; global settings for everything else. The in-app **Docs** page covers it all.

---

## 🎮 How to use

- **Click a pet** → its radial **skill wheel** opens (even mid-walk). Pick from chat, voice, screen vision, reminders, tricks, and more.
- **Alt+click a pet** → jump straight into a **chat panel** — type, or toggle the mic and just talk.
- **Drag & throw** → grab a pet, fling it, and watch it tumble with real momentum. Throw too hard and it gets dizzy.
- Everywhere you're *not* touching a pet, clicks pass straight through to your apps — pets never get in the way.

<!-- 📸 TODO(Akshit): screenshot — skill wheel closeup around a pet -->

<!-- 📸 TODO(Akshit): screenshot — chat panel conversation with a pet -->

---

## 🧠 A note on long-term memory

Long-term memory is **off by default** for every character. Turning it on requires two things:

1. **Enable it in the Convai dashboard** for that character (character → Memory tab → Memory Settings → Enable Long Term Memory).
2. **A Convai plan with memory allowance** — remembered-user and interaction limits vary by tier; check [convai.com/pricing](https://convai.com/pricing) for current numbers.

The bundled default character IDs ship **without** LTM enabled on the Convai side, so memory features won't work out of the box until you point a character at your own LTM-enabled Convai character.

<!-- TODO(Akshit): once an LTM-enabled public character exists, set DEFAULT_LTM_CHARACTER_ID in src/shared/constants.ts so first-run users can try memory features immediately. -->

Full details — including the end-user ID and the memory journal — are in the in-app Docs.

---

## 🎨 Available characters

| Genshin Impact | Others |
|----------------|--------|
| Ayaka | Deadpool |
| Albedo | SpongeBob |
| Chongyun | Cartman |
| Kazuha | |
| Hu Tao | |
| Klee | |
| Thoma | |
| Venti | |

Every character can be re-pointed at any Convai character you create — custom personality, backstory, and voice.

---

## 🛠️ Build from source

See **[BUILDING.md](./BUILDING.md)** for prerequisites, dev workflow, and the release process. The design document lives at [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

```bash
git clone https://github.com/AkshitIreddy/AI-Desktop-Pet.git
cd AI-Desktop-Pet
npm install
npm run tauri dev
```

---

## 🙏 Acknowledgments & Credits

This project wouldn't be possible without the amazing work of the following creators:

### Character Artists 🎨
A huge thank you to the talented artists who created the beautiful character sprites:

- **[@uuteki](https://linktr.ee/uuteki)** — Creator of the Genshin Impact character shimejis:
  - Venti, Thoma, Kazuha, Ayaka, Chongyun, Klee, Hu Tao, and Albedo
- **[Phinbella-Flynn](https://www.deviantart.com/phinbella-flynn/art/Cartman-Shimeji-747213748)** — Creator of the Cartman shimeji
- **[Sojia](https://sojia.deviantart.com/art/Spongebob-Shimeji-Mascot-317014699)** — Creator of the Spongebob shimeji
- **[Cakedoom](https://cakedoom.deviantart.com/art/Deadpool-shimeji-267525091)** — Creator of the Deadpool shimeji

Want more shimejis? Check out the [Shimejis Directory](https://shimejis.xyz/directory) for hundreds of characters!

### Original Shimeji Creator
- **Yuki Yamada** — Creator of the original Shimeji concept and software (2009)

### Shimeji-ee Development
- **Shimeji-ee Group** — For the enhanced Shimeji engine
- **[Kilkakon](https://kilkakon.com)** — For continued development and improvements to Shimeji-ee
- **TigerHix** — For contributions on GitHub that were incorporated into this project

### Additional Libraries
- **John O'Conner** — i18n internationalization classes
- **Nilo J. González** — NimROD Look And Feel (LGPL v3)

### Technologies
- [Tauri](https://tauri.app) — Lightweight cross-platform desktop framework
- [Convai](https://convai.com) — AI conversation engine
- [LiveKit](https://livekit.io) — Realtime WebRTC voice transport (via the Convai Web SDK)

---

## 📄 License

This project includes components under various licenses. See the [licenses](./licenses/) folder for complete details.

---

## 💖 Enjoy Your Desktop Companions!

If you like this project, consider giving it a ⭐ on GitHub!

Made with ❤️ by [AkshitIreddy](https://github.com/AkshitIreddy)
