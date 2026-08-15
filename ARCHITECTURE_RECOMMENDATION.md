# AI REALTIME STUDIO — Architecture Recommendation & Design Directions

> **Working Name**: AI REALTIME STUDIO  
> **Date**: 2026-08-15  
> **Status**: AWAITING PRODUCT OWNER APPROVAL  
> **Classification**: Phase 0 — Discovery Complete, Architecture Proposed

---

# PART 1: UNDERSTANDING SUMMARY

## What You Want to Build

A browser-first, premium realtime AI media studio where a user opens their camera and microphone, sees a live preview, selects an AI transformation, and immediately experiences their video and voice transformed in realtime — with synchronized output, recording capability, and a cinematic professional interface.

This is NOT a video generator, NOT an AI avatar platform, NOT a filter app. It is a **realtime interactive media system** with provider-agnostic AI pipelines.

## Critical Distinctions from Existing Products

The market has two categories:
1. **AI Avatar platforms** (HeyGen, D-ID, Tavus, Synthesia) — Generate synthetic talking heads from text/audio. **NOT what you're building.**
2. **Webcam transformation** (face swap, style transfer, background replacement on YOUR live feed) — **This IS what you're building.**

The managed API market for category #2 is nearly empty. Only **Akool** offers a turnkey realtime face swap API. For everything else (style transfer, background, VFX, appearance), you need self-hosted models on GPU infrastructure.

## Key Constraints

| Constraint | Impact |
|---|---|
| Desktop + Mobile from day one | Dual-layout architecture, touch-first mobile UX, device capability matrix |
| Provider agnostic | Abstraction layers at every AI boundary |
| Real balance of quality/latency/cost | Cannot optimize for one dimension alone |
| 10-50 concurrent MVP, scales to 1000+ | Horizontal GPU worker scaling |
| No fake functionality | Every UI control must connect to real implementation |
| Original product, not a clone | Independent design, architecture, and codebase |

---

# PART 2: KEY RESEARCH FINDINGS

## 2.1 Realtime Video Transformation — Critical Market Gap

**Finding: The managed API market for realtime webcam stream transformation is nearly empty.**

| Provider | What it does | Realtime webcam transform? | Production ready? |
|---|---|---|---|
| **Akool** | Face swap via WebRTC | **YES** (face only) | YES, but: credit pricing, no FPS/latency docs, vendor lock-in, Agora dependency |
| **Fal.ai** | Realtime WebSocket inference | PARTIAL (infra only, no turnkey video model) | Infrastructure YES, models NO |
| **RunPod** | GPU infrastructure | If you build it | Infrastructure YES |
| Replicate, OpenAI, Stability AI, HF | Various AI | **NO** | NO for realtime video |
| HeyGen, D-ID, Tavus, Synthesia | AI avatars | **NO** (wrong category) | N/A |

**Implication**: For most transformation types (style, background, VFX, appearance), you MUST self-host open-source models. The provider abstraction layer is not optional — it is the core architecture.

## 2.2 Realtime Voice Conversion — Open Source Leads

| Option | Type | Latency | GPU? | Production Ready? |
|---|---|---|---|---|
| **RVC** (self-hosted) | Open source | 90-170ms | Yes (6GB+) | **YES** — best ecosystem, proven |
| **w-okada/voice-changer** | Open source wrapper | 90-170ms | Yes | **YES** — best runtime wrapper for RVC |
| **Wondera** | Managed API | <50ms claimed | No | CONDITIONAL — new, unverified |
| **Dubbing AI** | Local SDK + API | <30ms claimed | No (CPU) | CONDITIONAL — interesting local processing |
| **ElevenLabs VC** | Managed API | UNKNOWN | No | CONDITIONAL — streaming endpoint exists but untested |
| **LLVC** | Research | <20ms on CPU | **No** | NO — research code only |
| Web Audio API | Browser native | <10ms | No | NO — signal processing only, not AI VC |

**Implication**: Self-hosted RVC is the most production-ready option. Managed APIs (Wondera, ElevenLabs) need latency testing. The provider abstraction must support both.

## 2.3 Lip Sync — Clear Winner for Self-Hosted

| Option | Type | Latency | Self-hosted? | Production Ready? |
|---|---|---|---|---|
| **MuseTalk** (Tencent) | Open source | 30-60fps realtime | YES | **YES** — best open-source realtime lip sync |
| **SyncLabs sync-react-1** | Managed API | ~12ms model | NO | **YES** — fastest API option |
| **LatentSync** (ByteDance) | Open source | Too slow for realtime | YES | NO for realtime, YES for batch |
| Wav2Lip | Open source | Realtime on strong GPU | YES | MEDIUM — outdated (2020) |
| D-ID, Simli, Tavus | Avatar platforms | Various | NO | Wrong category (generate avatar, don't re-sync your video) |

**Implication**: MuseTalk self-hosted for cost efficiency. SyncLabs as API fallback/initial integration.

## 2.4 Media Transport — LiveKit is the Clear Choice

| Option | Server can subscribe/publish tracks? | Self-hosted? | AI agent framework? | Recording? |
|---|---|---|---|---|
| **LiveKit** | **YES** — purpose-built for this | **YES** (open source) | **YES** (Python/Node.js) | **YES** (composite, track, individual) |
| Agora | NO | NO | NO | YES (cloud) |
| Daily.co | Limited | NO | Bots (limited) | YES |
| mediasoup | YES (DIY) | YES | NO (build yourself) | NO (build yourself) |
| Raw WebRTC | YES (build everything) | N/A | NO | NO |

**LiveKit's Agents framework** is literally designed for: browser publishes track → server-side agent subscribes → processes with AI → republishes transformed track. This is your exact use case.

## 2.5 GPU Infrastructure — RunPod Leads for Self-Hosting

| Provider | A100 80GB ($/hr) | RTX 4090 ($/hr) | Serverless? | Best for |
|---|---|---|---|---|
| **RunPod** | $1.39-$1.89 | $0.77-$1.10 | **YES** | Best overall — serverless + pods + per-second billing |
| **Fal.ai** | ~$1.89-$2.49 | N/A | **YES** (WebSocket) | Realtime WebSocket inference |
| **Modal** | $2.10-$2.50 | N/A | **YES** (Python) | Python-first serverless GPU |
| TensorDock | $1.80 | $0.31 | NO | Cheapest dedicated H100 |
| Vast.ai | $0.47-$1.32 | $0.13-$0.39 | NO | Cheapest overall (volatile) |
| Replicate | $5.04 | N/A | YES | Easiest (most expensive) |
| AWS | $3.43-$4.09/GPU | N/A | SageMaker | If already in AWS ecosystem |

---

# PART 3: THREE ARCHITECTURE OPTIONS

## ARCHITECTURE DIAGRAM (Shared across all tiers)

```text
┌─────────────────────────────────────────────────────────┐
│                    BROWSER (React + Vite)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Media Capture │  │  Studio UI   │  │  State Mgmt   │  │
│  │ (Camera/Mic)  │  │ (shadcn/ui)  │  │  (Zustand)    │  │
│  └──────┬───────┘  └──────────────┘  └───────────────┘  │
│         │                                                  │
│  ┌──────┴───────┐                                        │
│  │ LiveKit SDK  │  ← WebRTC tracks in/out                │
│  └──────┬───────┘                                        │
└─────────┼───────────────────────────────────────────────┘
          │ WebRTC
┌─────────┼───────────────────────────────────────────────┐
│  ┌──────┴───────┐     LIVEKIT SERVER                      │
│  │   Room       │  (self-hosted or cloud)                 │
│  │  Manager     │                                        │
│  └──────┬───────┘                                        │
│         │                                                │
│  ┌──────┴───────────────────────────────────────────┐   │
│  │           AI AGENTS FRAMEWORK                      │   │
│  │  ┌─────────┐ ┌──────────┐ ┌───────────────────┐  │   │
│  │  │  Video  │ │  Voice   │ │    Lip Sync       │  │   │
│  │  │ Worker  │ │  Worker  │ │    Worker         │  │   │
│  │  └────┬────┘ └────┬─────┘ └────────┬──────────┘  │   │
│  └───────┼───────────┼───────────────┼──────────────┘   │
│          │           │               │                   │
│  ┌───────┴───────────┴───────────────┴──────────────┐   │
│  │           PROVIDER ABSTRACTION LAYER               │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │   │
│  │  │ Video AI │ │ Voice AI │ │   Lip Sync AI    │  │   │
│  │  │ Adapter  │ │ Adapter  │ │   Adapter        │  │   │
│  │  └────┬─────┘ └────┬─────┘ └────────┬──────────┘  │   │
│  └───────┼────────────┼───────────────┼──────────────┘   │
└──────────┼────────────┼───────────────┼──────────────────┘
           │            │               │
    ┌──────┴────┐  ┌────┴─────┐  ┌─────┴──────┐
    │  Video   │  │  Voice   │  │  Lip Sync  │
    │ Provider │  │ Provider │  │  Provider   │
    │(Akool/  │  │(RVC/     │  │(MuseTalk/  │
    │Self-host)│  │Wondera)  │  │SyncLabs)   │
    └──────────┘  └──────────┘  └────────────┘

┌──────────────────────────────────────────────────────────┐
│                    SUPPORTING SERVICES                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │PostgreSQL│ │  Redis   │ │   S3     │ │  Observability│ │
│  │(Users,   │ │(Sessions,│ │(Media,   │ │(Metrics,    │ │
│  │Projects, │ │Cache,    │ │Refs,     │ │Logs, Traces)│ │
│  │Sessions) │ │Pub/Sub)  │ │Recs)     │ │              │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## OPTION A: LEAN ARCHITECTURE

### Philosophy
Minimum viable infrastructure cost. Use managed APIs wherever possible. Self-host only what has no managed alternative. Optimize for getting to MVP fastest with lowest financial risk.

### Component Choices

| Layer | Choice | Why | Monthly Cost (10-50 concurrent) |
|---|---|---|---|
| **Frontend** | React + Vite + Tailwind + shadcn/ui | Free, fast, mobile-ready | $0 (dev) + hosting ~$20-50 |
| **Media Transport** | LiveKit Cloud | No infra management, $0.01/min agent sessions | ~$50-200/mo |
| **Video Transform** | Akool Live Face Swap API | Only turnkey realtime webcam face swap | ~$300-900/mo (at $0.17-0.43/min, 50 sessions avg 30min) |
| **Voice Convert** | RVC self-hosted on 1× RunPod RTX 4090 pod | Cheapest voice option, proven quality | ~$55-80/mo (always-on pod) |
| **Lip Sync** | SyncLabs sync-react-1 API | No GPU needed, ~12ms latency | ~$200-600/mo (at $0.02-0.13/sec) |
| **Backend API** | Node.js (Fastify) on Railway/Fly.io | Lightweight, cheap | ~$5-20/mo |
| **Database** | PostgreSQL (Neon/Supabase free tier) | Free tier covers MVP | $0-25/mo |
| **Redis** | Upstash (free tier) | Serverless Redis, pay-per-request | $0-10/mo |
| **Object Storage** | Cloudflare R2 | S3-compatible, no egress fees | ~$0-15/mo |
| **Auth** | Custom JWT (bcrypt + short-lived tokens) | No vendor dependency | $0 |

### Estimated Monthly Cost

| Scenario | Cost |
|---|---|
| 10 concurrent sessions, 30 min each/day | ~$200-400/mo |
| 50 concurrent sessions, 30 min each/day | ~$800-1,800/mo |

### Pros
- Lowest upfront infrastructure investment
- Fastest to MVP (managed APIs, less engineering)
- No GPU cluster management
- Per-use pricing scales with actual usage

### Cons
- **Akool dependency** — only does face swap, not style/background/VFX/appearance
- **No style transfer, background replacement, or VFX** in MVP (would need custom model deployment)
- **Vendor lock-in risk** on Akool (proprietary, no self-host option)
- **Akool FPS/latency untested** — could be unacceptable for production
- Credit-based pricing with monthly expiration is wasteful
- Lip sync API costs add up at scale

### What's Missing from Lean
- Style transfer, artistic filters, background replacement, VFX, appearance transformation, clothing transformation — these require self-hosted models that Lean doesn't include
- The product would launch with face swap + voice change + lip sync only

### Verdict
**Lean is too limited for your stated requirements.** You explicitly listed style, background, VFX, appearance, and clothing as mandatory. Lean cannot deliver these without adding self-hosted GPU workers, which pushes it toward Balanced.

---

## OPTION B: BALANCED ARCHITECTURE ⭐ RECOMMENDED

### Philosophy
Best overall balance of quality, latency, reliability, and cost. Self-host the AI models that have no good managed alternative. Use managed APIs for what they do well. Horizontal GPU worker scaling from day one.

### Component Choices

| Layer | Choice | Why | Monthly Cost (10-50 concurrent) |
|---|---|---|---|
| **Frontend** | React + Vite + Tailwind 4 + shadcn/ui | Premium dark UI, mobile-first | $0 (dev) + hosting ~$20-50 |
| **Media Transport** | **LiveKit** (self-hosted on $20-40 VPS or cloud) | Full control, no per-minute cost, open source | ~$20-40/mo (VPS) or ~$50-200 (cloud) |
| **Video Transform** | **Self-hosted models on RunPod GPU pods** | Akool only does face swap. Self-hosting enables: face swap (InsightFace/SimSwap), style transfer, background replacement, VFX | ~$200-600/mo (2-4× RTX 4090 pods, scalable) |
| **Voice Convert** | **RVC on dedicated GPU pod** | Best quality, lowest per-user cost, massive voice ecosystem | ~$55-80/mo (1× RTX 4090 always-on) |
| **Lip Sync** | **MuseTalk self-hosted** on video GPU pod | Free, 30-60fps, best open-source realtime lip sync | Included in video GPU cost |
| **SyncLabs API** | Fallback for lip sync | If MuseTalk has issues or for higher quality offline | ~$0-200/mo (fallback only) |
| **Backend API** | Node.js (Fastify) + TypeScript | Type-safe, fast, ecosystem | ~$5-20/mo |
| **Session Orchestrator** | Custom service (Node.js) | Coordinates workers, providers, sessions | Included in backend |
| **Database** | PostgreSQL (Neon or self-hosted) | Users, projects, sessions, usage, audit | ~$0-25/mo |
| **Redis** | Upstash or self-hosted | Session state, caching, pub/sub | ~$0-10/mo |
| **Object Storage** | Cloudflare R2 | Media files, reference images, recordings | ~$0-20/mo |
| **Auth** | Custom JWT + bcrypt + refresh rotation | No vendor lock-in | $0 |
| **Observability** | OpenTelemetry + Prometheus + Grafana (self-hosted) | Metrics, traces, logs | ~$0-30/mo |

### GPU Worker Architecture

```text
Session Orchestrator
       │
       ├──> Video Worker Pool (RunPod RTX 4090 pods)
       │    ├── Face swap model (InsightFace)
       │    ├── Style transfer model
       │    ├── Background removal/replacement
       │    ├── VFX pipeline
       │    └── MuseTalk lip sync
       │
       ├──> Voice Worker Pool (RunPod RTX 4090 pods)
       │    └── RVC voice conversion
       │
       └──> Fallback Providers (API)
            ├── Akool (face swap backup)
            ├── SyncLabs (lip sync backup)
            └── Wondera (voice backup)
```

**Scaling model:**
- Start with 2-3 GPU pods (video + voice)
- Each pod handles 2-5 concurrent sessions depending on model complexity
- Autoscale based on queue depth and latency
- RunPod serverless for burst, dedicated pods for baseline

### Estimated Monthly Cost

| Scenario | Cost |
|---|---|
| 10 concurrent, 30min/day | ~$400-800/mo |
| 50 concurrent, 30min/day | ~$1,200-2,500/mo |
| 100 concurrent, 30min/day | ~$2,500-5,000/mo |

### Cost Per Session Minute

| Component | Cost/min |
|---|---|
| Video transform (GPU) | ~$0.008-0.015 |
| Voice conversion (GPU) | ~$0.003-0.005 |
| Lip sync (included in video GPU) | $0 |
| Media transport (LiveKit self-hosted) | $0 |
| Infrastructure (DB, Redis, storage) | ~$0.001 |
| **Total** | **~$0.012-0.021/min** |

### Pros
- **Delivers ALL mandatory features** — face swap, appearance, style, background, VFX, voice, lip sync
- **Provider agnostic** — self-hosted models can be swapped, API fallbacks available
- **Horizontal scaling** — add GPU workers as load grows
- **No vendor lock-in on AI** — can migrate to own models, different providers
- **Cost scales with usage** — GPU pods can scale to zero during low traffic
- **LiveKit self-hosted** — no per-minute transport cost
- **MuseTalk is free** — no lip sync API cost
- **RVC is free** — voice conversion at GPU cost only

### Cons
- **Higher engineering effort** than Lean — must containerize and deploy models
- **GPU management required** — monitoring, scaling, health checks
- **Model quality depends on open-source state** — may not match commercial solutions
- **Need to build model deployment pipeline** — Docker containers, health endpoints, model loading

### Migration Path
- Lean → Balanced: Add GPU worker pods, deploy models, add provider adapters
- Balanced → Premium: Upgrade GPU types, add multi-region, add model optimization

### Verdict
**This is the recommended starting architecture.** It delivers all mandatory features, maintains provider independence, scales horizontally, and keeps per-session costs low. The engineering investment in GPU worker management is unavoidable given the market gap in managed realtime video transformation APIs.

---

## OPTION C: PREMIUM ARCHITECTURE

### Philosophy
Maximum quality, lowest latency, highest reliability. Enterprise-grade infrastructure. Multiple provider failover. Multi-region. Optimized model inference.

### Component Choices

| Layer | Choice | Why | Monthly Cost (50+ concurrent) |
|---|---|---|---|
| **Frontend** | React + Vite + Tailwind 4 + shadcn/ui + R3F | Same as Balanced + selective 3D | ~$20-50 |
| **Media Transport** | LiveKit (self-hosted, multi-region) | Redundancy, lowest latency per region | ~$100-400/mo |
| **Video Transform** | **Self-hosted on dedicated A100/H100 cluster** | Maximum quality, optimized inference | ~$2,000-5,000/mo |
| **Voice Convert** | RVC on dedicated A100 pod + Wondera/ElevenLabs failover | Best quality + managed backup | ~$500-1,500/mo |
| **Lip Sync** | MuseTalk + SyncLabs sync-3 (offline) + SyncLabs sync-react-1 (realtime) | Best quality in every scenario | ~$200-800/mo |
| **Backend** | Kubernetes (multiple replicas) | High availability, rolling deploys | ~$200-500/mo |
| **Database** | PostgreSQL HA (multi-AZ) | RPO ≈ 0, RTO < 5 min | ~$100-300/mo |
| **Redis** | Redis Cluster (HA) | No single point of failure | ~$50-200/mo |
| **Object Storage** | S3 with replication | Multi-region durability | ~$50-200/mo |
| **Observability** | Full OpenTelemetry + Grafana + PagerDuty | Production-grade alerting | ~$50-200/mo |
| **CDN** | Cloudflare Enterprise | Global asset delivery | ~$20-200/mo |
| **Security** | WAF, DDoS protection, secret manager | Enterprise security | ~$50-200/mo |

### Estimated Monthly Cost

| Scenario | Cost |
|---|---|
| 50 concurrent | ~$3,500-9,000/mo |
| 100 concurrent | ~$7,000-18,000/mo |
| 1000 concurrent | ~$30,000-80,000/mo (with model optimization) |

### Pros
- Highest quality output
- Lowest latency (A100/H100 inference, multi-region transport)
- Highest reliability (HA everything, failover everywhere)
- Enterprise-grade security and observability
- Can handle 1000+ concurrent with optimization

### Cons
- **Significantly higher cost** even at low concurrency
- **Over-engineered for MVP** — most of this infrastructure is wasted at 10-50 users
- **More complex to operate** — K8s, multi-region, HA databases
- **Locks in cost structure** before validating product-market fit

### Verdict
**Premium is the target architecture for later.** Start with Balanced, then upgrade infrastructure components as concurrency and revenue justify it. The codebase should be architected to support Premium (separable concerns, horizontal scaling), but the infrastructure spend should not.

---

# PART 4: RECOMMENDED TECHNOLOGY STACK (BALANCED)

## Frontend

| Component | Choice | License | Confidence |
|---|---|---|---|
| Framework | React 18+ with Vite | MIT | VERIFIED |
| Language | TypeScript | — | — |
| Styling | Tailwind CSS 4 | MIT | VERIFIED |
| Components | shadcn/ui (Vite template) | MIT | VERIFIED |
| State | Zustand | MIT | VERIFIED |
| Animation | Motion (primary) + GSAP (cinematic) | MIT + Free | VERIFIED |
| Icons | Lucide (primary) + Phosphor (secondary) | ISC + MIT | VERIFIED |
| 3D | React Three Fiber + drei (lazy-loaded, selective) | MIT | VERIFIED |
| Media | LiveKit SDK (browser) | Apache 2.0 | VERIFIED |
| Audio | Web Audio API (native) | — | VERIFIED |
| Routing | React Router | MIT | VERIFIED |

## Backend

| Component | Choice | License | Confidence |
|---|---|---|---|
| Runtime | Node.js + TypeScript | MIT | — |
| Framework | Fastify | MIT | VERIFIED |
| Validation | Zod | MIT | VERIFIED |
| ORM | Prisma | Apache 2.0 | VERIFIED |
| Realtime | LiveKit Server SDK (Node.js) | Apache 2.0 | VERIFIED |
| Auth | Custom JWT + bcrypt | MIT | — |
| Env Config | dotenv + zod validation | MIT | — |

## AI Workers (Python)

| Component | Choice | License | Confidence |
|---|---|---|---|
| Runtime | Python 3.10+ | — | — |
| Framework | FastAPI | MIT | VERIFIED |
| Media Transport | LiveKit Agents SDK (Python) | Apache 2.0 | VERIFIED |
| Video Models | InsightFace, SimSwap, custom style transfer | Various open source | — |
| Voice Model | RVC | MIT | VERIFIED |
| Lip Sync | MuseTalk | Apache 2.0 | VERIFIED |
| Audio Processing | scipy, librosa, soundfile | Various | — |

## Infrastructure

| Component | Choice | Why |
|---|---|---|
| GPU Workers | RunPod (Secure Cloud pods + Serverless overflow) | Best price/performance, per-second billing, Docker |
| Media Transport | LiveKit (self-hosted on VPS) | Full control, no per-minute cost |
| Database | PostgreSQL (Neon or self-hosted) | Reliable, feature-rich |
| Cache | Redis (Upstash or self-hosted) | Session state, pub/sub |
| Storage | Cloudflare R2 (S3-compatible) | No egress fees |
| Monitoring | OpenTelemetry + Prometheus + Grafana | Industry standard |

---

# PART 5: THREE DESIGN DIRECTIONS

## Direction 1: "OBSIDIAN COMMAND"

```
NAME: OBSIDIAN COMMAND
MOOD: Dark mission-control — like a spacecraft operations center
   meets a premium video editing suite.
PRIMARY USE CASE: Power users, developers, technical creators
COLOR DIRECTION:
  - Background: Near-black (#0A0A0F) with subtle blue undertones
  - Surface: Dark charcoal (#14141F) with soft raised edges
  - Primary text: Cool white (#F0F0F5)
  - Accent: Electric cyan (#00D4FF) for active states, CTAs, live indicators
  - Secondary accent: Warm amber (#FFB020) for warnings, recording states
  - Success: Muted emerald (#10B981)
  - Error: Soft red (#EF4444)
  - Subtle gradient: Dark navy to near-black on main backgrounds
TYPOGRAPHY:
  - Display: Space Grotesk (700-800 weight, wide letterforms)
  - Body: Geist Sans (400-500, clean and minimal)
  - Mono: JetBrains Mono (for diagnostics, timestamps, technical readouts)
ICON STYLE: Lucide — stroke-based, 1.5px, consistent line weight
CARD/CONTAINER STYLE: Dark surfaces with 1px border (rgba(255,255,255,0.06)),
  subtle inner shadow, 8-12px border-radius. No glassmorphism.
MOTION LANGUAGE: Precise, functional. Quick fade+slide transitions (150ms).
  Status changes: color transitions (200ms). Recording pulse: slow amber glow.
  No bouncy/springy motion.
MOBILE APPROACH: Stripped-down control bar at bottom. Full-screen preview.
  Swipe-up sheets for settings. No side panels.
WHY IT FITS: Feels like professional software, not a consumer app.
  The dark command-center aesthetic matches the "realtime AI lab" positioning.
  Cyan accents evoke technology and precision.
RISKS:
  - Could feel cold or intimidating to non-technical users
  - Cyan-on-dark needs careful contrast management for accessibility
  - Less visual warmth may not appeal to creative/fashion users
```

---

## Direction 2: "LUMIÈRE STUDIO"

```
NAME: LUMIÈRE STUDIO
MOOD: Premium cinematic creative suite — like a high-end film
   production tool with warmth and sophistication.
PRIMARY USE CASE: Content creators, streamers, creative professionals
COLOR DIRECTION:
  - Background: Deep warm black (#0D0B0E) with subtle purple undertones
  - Surface: Dark plum-charcoal (#1A1720) with soft glass effect
  - Primary text: Warm white (#F5F0EB)
  - Accent: Rose gold / warm coral (#E8A87C) for primary actions
  - Secondary accent: Soft lavender (#A78BFA) for secondary elements
  - Live indicator: Warm green (#34D399)
  - Recording: Rich red (#F87171)
  - Subtle gradient: Warm dark gradient with very subtle noise texture
TYPOGRAPHY:
  - Display: Clash Display (bold, editorial, from Fontshare)
  - Body: Plus Jakarta Sans (warm geometric, excellent dark-mode readability)
  - Mono: Geist Mono (pairs with clean body font if switching later)
ICON STYLE: Phosphor (duotone variant for featured states, regular for standard)
  — the duotone adds visual richness without being heavy
CARD/CONTAINER STYLE: Subtle glassmorphism — frosted dark glass with
  backdrop-blur(12px), 1px border rgba(255,255,255,0.08), 12-16px radius.
  Restrained — only on major panels, not every element.
MOTION LANGUAGE: Cinematic. Smooth ease-out transitions (200-300ms).
  Subtle parallax on canvas area. Loading states with gentle pulse.
  Recording indicator: soft breathing glow. Panel transitions: slide+fade.
MOBILE APPROACH: Camera-first with frosted-glass control overlays.
  Bottom sheet for transformation panel with blur background.
  Swipe gestures for preset browsing.
WHY IT FITS: The warmth and sophistication appeal to creative professionals.
  The cinematic feel matches "premium video studio" positioning.
  Rose gold + lavender is distinctive without being garish.
RISKS:
  - Glassmorphism can impact performance on mobile if overused
  - The warm aesthetic may feel less "technical" to developer users
  - Clash Display requires Fontshare distribution (not on Google Fonts)
  - Purple/lavender tones need careful handling to avoid "generic AI startup" look
```

---

## Direction 3: "VOID LAB"

```
NAME: VOID LAB
MOOD: Minimalist futuristic laboratory —极致 minimal, high-contrast,
   functional beauty. Think Apple Pro products meets CERN control room.
PRIMARY USE CASE: Design-conscious users, tech-forward creators, early adopters
COLOR DIRECTION:
  - Background: True black (#000000) or near-black (#050505)
  - Surface: Dark gray (#111111) with no visible border — distinguished by
    elevation and subtle shadow only
  - Primary text: Pure white (#FFFFFF) at high contrast
  - Accent: Single accent — vivid violet (#7C3AED) or electric indigo (#6366F1)
  - Muted text: Medium gray (#888888)
  - Status colors: Minimal — green (#22C55E) for live, red (#EF4444) for error
  - NO gradients. NO glow. NO noise texture. Pure flat surfaces.
TYPOGRAPHY:
  - Display: Instrument Sans (precise, balanced, less common = more distinctive)
  - Body: Inter (the industry standard — invisible, perfectly legible)
  - Mono: IBM Plex Mono (technical, pairs with Inter's neutrality)
ICON STYLE: Lucide — but at 1.5px stroke, slightly rounded line caps.
  Maximum consistency. No colored icons — monochrome white/gray, accent only
  for active states.
CARD/CONTAINER STYLE: Flat dark surfaces, no borders. Elevation via shadow only
  (shadow-2xl, black). 8px border-radius. Content speaks for itself.
  Maximum whitespace. Density is low.
MOTION LANGUAGE: Almost none. Functional only. Opacity fades (100ms).
  State changes are instant color swaps. The only "cinematic" motion is
  on the video canvas itself. UI gets out of the way.
MOBILE APPROACH: Ultra-minimal. Full-screen video with floating minimal controls.
  Single bottom bar. Everything else is hidden until tapped.
  Maximum canvas, minimum chrome.
WHY IT FITS: The restraint communicates extreme confidence and quality.
  Black + white + one accent is timeless. Feels expensive because of
  what is NOT there, not what is.
RISKS:
  - Low information density may frustrate power users who want
    many controls visible simultaneously
  - Pure black backgrounds can cause OLED burn-in on mobile
  - Minimal UI requires excellent information architecture to avoid
    hiding functionality behind too many taps
  - Less visual "personality" may not differentiate from other
    minimalist dark apps
  - Instrument Sans is less battle-tested in production
```

---

## Design Direction Comparison

| Dimension | Obsidian Command | Lumière Studio | Void Lab |
|---|---|---|---|
| **Personality** | Technical, precise, professional | Creative, cinematic, warm | Minimalist, confident, refined |
| **Best for** | Developers, power users, technical creators | Content creators, streamers, artists | Design-conscious, tech-forward users |
| **Differentiation** | High (cyan-on-dark command center) | High (rose gold + lavender warmth) | Medium (extreme minimalism is a crowded space) |
| **Mobile suitability** | Good (clean, functional) | Very good (frosted glass, touch-first) | Excellent (minimal chrome, max canvas) |
| **Desktop suitability** | Excellent (dense panels, data-rich) | Excellent (warm professional workspace) | Good (but may feel sparse for power users) |
| **Accessibility** | Medium (cyan contrast needs care) | Good (warm whites on dark) | Excellent (pure white on black) |
| **"Premium" feel** | High (feels like expensive software) | Very high (feels like luxury creative tool) | High (feels like Apple/CERN) |
| **Implementation risk** | Low (standard dark UI patterns) | Medium (glassmorphism perf management) | Low (simpler to implement) |
| **My recommendation** | Strong contender | **RECOMMENDED** | Strong contender |

### My Design Recommendation

**Lumière Studio** — with elements from Obsidian Command.

The warmth and cinematic quality of Lumière Studio best matches your stated goal of "instant, cinematic, responsive and premium." The rose gold accent is distinctive without being garish, and the Plus Jakarta Sans + Clash Display pairing gives strong typographic identity.

From Obsidian Command, I would borrow: the structured panel layout for desktop, the cyan accent for live/connected status indicators (replacing the warm green), and the precise functional animation language for non-canvas UI elements.

The hybrid would be:
- **Colors**: Lumière's warm dark base + rose gold primary accent + Obsidian's cyan for live indicators
- **Typography**: Clash Display (headings) + Plus Jakarta Sans (body) + JetBrains Mono (technical)
- **Panels**: Lumière's restrained glassmorphism on major surfaces + Obsidian's structured layout
- **Motion**: Functional precision from Obsidian + cinematic quality from Lumière
- **Mobile**: Lumière's camera-first with frosted glass overlays

---

# PART 6: IDENTIFIED RISKS & OPEN QUESTIONS

## High-Impact Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | **No managed API does realtime style transfer on video streams** | Must self-host — increases engineering effort | Budget 2-3 weeks for GPU worker pipeline |
| R2 | **Akool FPS/latency undocumented** | If using as fallback, quality is unknown | Test before committing; have self-hosted primary |
| R3 | **Open-source video model quality may not match commercial** | Output quality may disappoint users | Budget iteration time for model selection and tuning |
| R4 | **Mobile browser WebRTC variability** | Camera/mic may fail in in-app browsers | Graceful degradation per §102 of PRD |
| R5 | **GPU cost at scale** | 1000+ concurrent could be $30K+/mo | Model optimization, quantization, batching |

## Open Questions for Product Owner

| # | Question | Why It Matters |
|---|---|---|
| Q1 | Do you have any existing GPU cloud accounts or API keys? | Determines if we can start testing immediately |
| Q2 | Are you comfortable with the Balanced architecture's ~$400-800/mo starting cost? | If budget is tighter, we can reduce scope |
| Q3 | Which design direction do you prefer (or hybrid)? | Locks the visual identity before implementation |
| Q4 | Should we prioritize desktop or mobile for the first working build? | Both are required, but one must be built first |
| Q5 | Do you want to use LiveKit Cloud initially (faster setup) or self-host from day one? | Trade-off: speed vs. cost vs. control |

---

# PART 7: PROPOSED MIGRATION PATH

```text
PHASE 1 (Foundation)
  → Monorepo, TypeScript, lint, format, CI
  → Database schema (PostgreSQL + Prisma)
  → Base API (Fastify + auth)
  → Studio shell (React + Vite + shadcn/ui dark theme)

PHASE 2 (Media Capture + Transport)
  → Camera/mic capture with device selection
  → LiveKit integration (client + server)
  → WebRTC connection lifecycle
  → Mobile + desktop layouts

PHASE 3 (Video AI)
  → Provider abstraction layer
  → GPU worker pipeline (Docker + RunPod)
  → First video model (face swap — InsightFace/SimSwap)
  → Realtime frame processing via LiveKit Agents
  → Session orchestrator

PHASE 4 (Voice AI)
  → RVC worker deployment
  → Voice capture → preprocess → RVC → output pipeline
  → Voice preset system
  → Audio/video synchronization

PHASE 5 (Lip Sync)
  → MuseTalk deployment on video GPU worker
  → Sync integration with transformed audio
  → Drift detection and correction

PHASE 6 (Transformation UX)
  → Prompt system
  - Reference image pipeline
  → Style transfer model integration
  → Background replacement
  → VFX pipeline
  → Preset system

PHASE 7 (Recording + Export)
  → LiveKit Egress recording
  → Recording management (list, play, download, delete)
  → Export presets (9:16, 1:1, 16:9)

PHASE 8 (Projects + Polish)
  → Project save/load
  → Usage metering
  → Admin panel
  → Observability dashboard
  → Mobile optimization pass
  → Accessibility audit
  → Performance audit
```

---

**Awaiting your approval on:**
1. **Balanced architecture** (or modifications)
2. **Design direction** (Lumière Studio, Obsidian Command, Void Lab, or hybrid)
3. **Open questions** (Q1-Q5 above)

Once approved, I will proceed to Phase 1 (Foundation) implementation.
