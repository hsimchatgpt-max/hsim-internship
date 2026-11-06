import { callAgent, S, brandBrief, LANG_RULE } from './core.js';

const ASPECTS = ['9:16', '16:9', '1:1', '4:5'];
const KINDS = ['avatar', 'visual', 'avatar_pip'];

/** 1. Command Understanding Agent */
export const understandCommand = (command, hints = {}) => callAgent({
  agent: 'Command Understanding',
  temperature: 0.2,
  system: `You convert a user's content request into a precise production brief. Infer sensible defaults but respect anything the user states explicitly. Overrides supplied by the UI (hints) win over your inference. Language code must be one of: en-US, en-IN, en-GB, hi-IN, hinglish, bn-BD, ta-IN, te-IN, mr-IN, gu-IN, kn-IN, ml-IN, pa-IN, ur-PK, es-US, fr-FR, de-DE, pt-BR, it-IT, ja-JP, ko-KR, ar-EG, id-ID, ru-RU, tr-TR, vi-VN, th-TH.`,
  user: `Request: ${command}\nUI hints (JSON): ${JSON.stringify(hints)}`,
  schema: S.obj({
    contentType: S.enum(['video', 'image'], 'video unless the user clearly wants a static post/image/poster/thumbnail'),
    topic: S.str('one-sentence topic'),
    platform: S.str('target platform, e.g. Instagram Reels, YouTube Shorts, LinkedIn, generic'),
    aspect: S.enum(ASPECTS, '9:16 for Reels/Shorts/TikTok, 16:9 for YouTube/landscape, 1:1 or 4:5 for feed posts'),
    language: S.str('language code from the allowed list'),
    tone: S.enum(['neutral', 'warm', 'energetic', 'excited', 'calm', 'serious', 'storytelling', 'professional'], 'speaking/writing tone'),
    targetDurationSec: S.num('target video length in seconds (15-90); 0 for images'),
    wantsAvatar: S.bool('true if the user wants a presenter/talking avatar on screen'),
    mixAvatarAndVisual: S.bool('true if both avatar scenes and cinematic visual scenes are wanted'),
    audience: S.str('who the content is for'),
    constraints: S.arr(S.str(), 'explicit must-haves or must-avoids from the request'),
  }),
});

/** 3. Content Strategy Agent */
export const strategize = (brief, brand) => callAgent({
  agent: 'Content Strategist',
  system: `You are a senior social-content strategist. Produce a tight strategy that a scriptwriter can execute. Follow the brand profile strictly.\n${brandBrief(brand)}`,
  user: `Brief: ${JSON.stringify(brief)}`,
  schema: S.obj({
    angle: S.str('the single big idea'),
    hook: S.str('the first line/visual that stops the scroll'),
    keyMessages: S.arr(S.str(), '2-4 key messages'),
    structure: S.arr(S.str(), 'ordered beats of the piece'),
    cta: S.str('call to action'),
    visualStyle: S.str('overall look and feel in one sentence'),
  }),
});

/** 4. Research Agent — knowledge-based unless Search grounding is enabled in settings. */
export const research = (brief, strategy, { grounding = false } = {}) => callAgent({
  agent: 'Research',
  temperature: 0.3,
  tools: grounding ? [{ googleSearch: {} }] : undefined,
  system: `You gather accurate, usable facts for a short piece of content. ${grounding ? 'Use Google Search.' : 'You have no live web access: rely on well-established knowledge only.'} Never invent statistics, quotes, prices or dates. If you are not sure, set confidence to low and needsVerification to true. Respond with ONLY a JSON object: {"facts":[{"claim":string,"confidence":"high|medium|low","needsVerification":boolean}],"angles":[string],"warnings":[string]}.`,
  user: `Brief: ${JSON.stringify(brief)}\nStrategy: ${JSON.stringify(strategy)}`,
  schema: S.obj({
    facts: S.arr(S.obj({ claim: S.str(), confidence: S.enum(['high', 'medium', 'low']), needsVerification: S.bool() })),
    angles: S.arr(S.str()),
    warnings: S.arr(S.str(), 'claims or topics that need a human check'),
  }),
});

/** 5. Scriptwriting Agent */
export const writeScript = (brief, strategy, researchOut, brand, { feedback } = {}) => callAgent({
  agent: 'Scriptwriter',
  system: `You write short-form video scripts that sound spoken, not written. ${LANG_RULE(brief.language)}\nSplit the script into scenes of roughly 4-10 seconds of speech each (~2.5 spoken words per second). Total length close to ${brief.targetDurationSec}s.\nScene kinds: "avatar" = presenter talking to camera; "visual" = voice-over over cinematic visuals; "avatar_pip" = visuals with presenter inset.\n${brief.wantsAvatar ? (brief.mixAvatarAndVisual ? 'Mix avatar and visual scenes: open and close on the avatar, use visuals in between.' : 'Use avatar scenes throughout.') : 'Use visual scenes only (no avatar).'}\nOnly use facts from the research marked high/medium confidence. narration must contain ONLY words to be spoken (no stage directions, no emojis). onScreenText is a short caption-style overlay (max 8 words).\n${brandBrief(brand)}`,
  user: `Brief: ${JSON.stringify(brief)}\nStrategy: ${JSON.stringify(strategy)}\nResearch: ${JSON.stringify(researchOut)}${feedback ? `\nREVISION FEEDBACK FROM USER (apply it): ${feedback}` : ''}`,
  schema: S.obj({
    title: S.str(),
    scenes: S.arr(S.obj({
      narration: S.str('exact words to be spoken'),
      onScreenText: S.str('short overlay text'),
      kind: S.enum(KINDS),
    })),
  }),
});

/** 6. Scene Planning Agent */
export const planScenes = (brief, script, strategy) => callAgent({
  agent: 'Scene Planner',
  temperature: 0.6,
  system: `You are a video director. For each script scene (same order, same count) decide shot design. Visual style: ${strategy.visualStyle}. Keep visual continuity across scenes. For avatar scenes, describe only the framing/background mood, not the presenter.`,
  user: `Aspect: ${brief.aspect}\nScenes: ${JSON.stringify(script.scenes.map((s, i) => ({ i, kind: s.kind, narration: s.narration })))}`,
  schema: S.obj({
    scenes: S.arr(S.obj({
      shot: S.str('shot type and framing'),
      visualDescription: S.str('what is seen'),
      motion: S.enum(['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static']),
      transition: S.enum(['fade', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen', 'dissolve']),
      backgroundHint: S.str('background mood for avatar scenes / dominant colours for visuals'),
    })),
  }),
});

/** 7. Image Prompt Agent */
export const imagePrompts = (brief, plan, strategy, brand) => callAgent({
  agent: 'Image Prompts',
  temperature: 0.7,
  system: `You write prompts for a text-to-image model. One prompt per scene (same order). Be concrete: subject, setting, lighting, lens, palette, style. No text/logos in the image (text is added later). Aspect ratio ${brief.aspect}. Style: ${strategy.visualStyle}. Brand colours: ${brand?.colors?.primary || ''} ${brand?.colors?.secondary || ''}.`,
  user: `Scenes: ${JSON.stringify(plan.scenes.map((s, i) => ({ i, visualDescription: s.visualDescription, shot: s.shot })))}`,
  schema: S.obj({ prompts: S.arr(S.str()) }),
});

/** 8. Video Prompt Agent */
export const videoPrompts = (brief, plan, strategy) => callAgent({
  agent: 'Video Prompts',
  temperature: 0.7,
  system: `You write prompts for a text-to-video model. One per scene (same order): describe subject, action, camera movement, lighting, style, and mood in one paragraph. Aspect ${brief.aspect}. Style: ${strategy.visualStyle}. No on-screen text.`,
  user: `Scenes: ${JSON.stringify(plan.scenes.map((s, i) => ({ i, visualDescription: s.visualDescription, motion: s.motion })))}`,
  schema: S.obj({ prompts: S.arr(S.str()) }),
});

/** 9. Caption Agent (social caption + hashtags; on-video captions come from the narration itself) */
export const captions = (brief, script, brand) => callAgent({
  agent: 'Captions',
  system: `Write the social post caption for this video, in the content language (${brief.language}${brief.language === 'hinglish' ? ', Roman script' : ''}). Platform: ${brief.platform}. Brand voice: ${brand?.voice || 'n/a'}.`,
  user: `Title: ${script.title}\nNarration: ${script.scenes.map((s) => s.narration).join(' ')}`,
  schema: S.obj({ caption: S.str(), hashtags: S.arr(S.str(), '5-10 hashtags without #') }),
});

/** Image-post content agent (static posts) */
export const imageContent = (brief, strategy, researchOut, brand) => callAgent({
  agent: 'Image Content',
  system: `You design copy for a single social image post. ${LANG_RULE(brief.language).replace('narration', 'copy')} Headline max 8 words, subhead max 14 words, body max 30 words. Only use facts from research with high/medium confidence.\n${brandBrief(brand)}`,
  user: `Brief: ${JSON.stringify(brief)}\nStrategy: ${JSON.stringify(strategy)}\nResearch: ${JSON.stringify(researchOut)}`,
  schema: S.obj({
    headline: S.str(), subhead: S.str(), body: S.str(), cta: S.str(),
    imagePrompt: S.str('prompt for a text-to-image background, no text in the image'),
    caption: S.str('social caption'), hashtags: S.arr(S.str()),
  }),
});

/** 10. Quality Checking Agent — reviews copy + sampled frames (multimodal) */
export const qualityCheck = (brief, content, brand, frames = []) => callAgent({
  agent: 'Quality Checker',
  temperature: 0.2,
  system: `You are a strict QA editor. Review the content against the brief and brand. Check: language/script correct (${brief.language}), tone, brand rules, factual caution, readability of on-screen text, hook strength, CTA present, pacing/length, and — if frames are attached — visible defects (cut-off text, low contrast, artifacts, wrong aspect). Be honest; do not inflate scores. ${brandBrief(brand)}`,
  user: `Brief: ${JSON.stringify(brief)}\nContent: ${JSON.stringify(content)}\nAttached images: ${frames.length} sampled frame(s).`,
  parts: frames.map((b64) => ({ inlineData: { mimeType: 'image/jpeg', data: b64 } })),
  schema: S.obj({
    score: S.num('0-100'),
    pass: S.bool('true only if no high-severity issue'),
    issues: S.arr(S.obj({ severity: S.enum(['high', 'medium', 'low']), where: S.str(), problem: S.str(), fix: S.str() })),
    summary: S.str(),
  }),
});
