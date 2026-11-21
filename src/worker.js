const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const DEFAULT_CATS = ["Tarix", "Geografiya", "Eksperimentlar", "Effektlar", "Sindromlar"];

async function gemini(env, system, user) {
  const model = env.GEMINI_MODEL || "gemini-3-flash-preview";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192, temperature: 0.3 }
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || "Gemini xatosi");
  const t = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
  return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
}

async function wiki(term) {
  try {
    const u = "https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrlimit=1&gsrsearch=" + encodeURIComponent(term) +
      "&prop=extracts|info&explaintext=1&exchars=15000&inprop=url&format=json";
    const d = await (await fetch(u, { headers: { "user-agent": "zakovat-baza/1.0" } })).json();
    const p = Object.values(d.query?.pages || {})[0];
    return p ? { title: p.title, url: p.fullurl, text: p.extract } : null;
  } catch { return null; }
}

const SYS = `Sen "Zakovat" intellektual o'yini uchun ma'lumotnoma muharririsan. Faqat o'zbek tilida (lotin yozuvi) yoz. Berilgan Wikipedia matniga tayan va undan tashqari faqat aniq bilgan faktlaringni qo'sh. Yil, sana va sonlarni o'ylab topma; ishonching komil bo'lmasa, yozma. Javob faqat bitta JSON obyekt bo'lsin.`;

async function handle({ request, env }) {
  if (env.ACCESS_KEY && request.headers.get("x-key") !== env.ACCESS_KEY) return J({ error: "Kirish kaliti noto'g'ri" }, 401);
  const b = await request.json();
  try {
    if (b.action === "load") return J((await env.DB.get("db", "json")) || { items: [], cats: DEFAULT_CATS });
    if (b.action === "save") { await env.DB.put("db", JSON.stringify(b.db)); return J({ ok: 1 }); }

    if (b.action === "generate") {
      const cats = b.cats?.length ? b.cats : DEFAULT_CATS;
      const tr = await gemini(env, "Faqat JSON qaytar.", `Quyidagi atamaning inglizcha Wikipedia sarlavhasini yoki qidiruv iborasini top. Yil bo'lsa faqat raqamni, sana bo'lsa "July 20" kabi inglizcha yozuvni ber. JSON: {"en":""}. Atama: ${b.term}`);
      const w = await wiki(tr.en || b.term);
      const schema = {
        article: `{"title":"o'zbekcha sarlavha","cat":"mana shu toifalardan aynan biri: ${cats.join(", ")}","body":"250-350 so'z, 3-4 abzats, abzatslar \\n\\n bilan ajratilgan; asosiy ma'no, sabab-oqibat va yillar bilan"}`,
        year: `{"title":"<yil>-yil","events":["kamida 20 ta (20 dan 25 gacha) eng muhim va katta voqea, har biri 1 jumla, oy va joy bilan, xronologik tartibda"],"sort":<yil raqami>}`,
        date: `{"title":"<kun>-<oy nomi o'zbekcha>","events":["6-8 ta qisqa voqea, har biri yilidan boshlansin: '1969: ...'"],"sort":<oy*100+kun>}`
      }[b.type];
      const out = await gemini(env, SYS, `Mavzu: ${b.term}\nTuri: ${b.type}\nJSON shakli: ${schema}\n\nWikipedia matni (${w?.title || "topilmadi"}):\n${w?.text || "(yo'q)"}`);
      if (b.type === "article") {
        if (!cats.includes(out.cat)) out.cat = cats[0];
        if (w) out.image_query = w.title;
      }
      out.sources = [
        ...(w ? [{ title: "Wikipedia: " + w.title, url: w.url }] : []),
        { title: "Britannica (qidiruv): " + (tr.en || b.term), url: "https://www.britannica.com/search?query=" + encodeURIComponent(tr.en || b.term) }
      ];
      return J(out);
    }

    if (b.action === "questions") {
      const out = await gemini(env,
        "Sen Zakovat (Nima? Qayerda? Qachon?) savollarini o'zbekchaga tarjima qiluvchi va tahlil qiluvchi muharrirsan. Faqat JSON qaytar. Faqat berilgan savollarga tayan, hech narsa o'ylab topma.",
        `Atama: ${b.term}\n\nQuyida boshqa tilda nusxalangan matn bor. Atamaga eng aloqador savollardan ko'pi bilan 7 tasini tanla va o'zbekchaga (lotin) tarjima qil, javobni ham. Izoh bo'lsa "c" ga yoz. Keyin savollarga qarab 2-4 jumlada xulosa yoz: zakovatda bu atama odatda qanday mantiq yoki savol turlari bilan ishlatiladi. Xulosani faqat savollardan chiqar. JSON: {"analysis":"","questions":[{"q":"","a":"","c":""}]}\n\nOldingi savollar:\n${b.old || "(yo'q)"}\n\nYangi matn:\n${String(b.raw).slice(0, 15000)}`);
      return J(out);
    }

    if (b.action === "samples") {
      const out = await gemini(env,
        "Sen Zakovat uslubidagi savollar yozuvchi muharrirsan. O'zbek tilida (lotin) yoz. Faqat JSON qaytar.",
        `Atama: ${b.term}\n\nMaqola:\n${b.body}\n\nVazifa: "analysis": 2-4 jumla, zakovatda bu atama odatda qanday mantiq va savol turlari bilan ishlatilishi (umumiy tahlil, ishonching komil bo'lmasa "ehtimol" de). "questions": 6-7 ta original namuna savol, javobi aniq, javobning o'zini savolda yozma, faqat maqoladagi faktlarga tayan; har biriga "a" va "c". JSON: {"analysis":"","questions":[{"q":"","a":"","c":""}]}`);
      return J(out);
    }

    if (b.action === "quiz") {
      const out = await gemini(env,
        "Sen xotirani mustahkamlash uchun test tuzuvchisan. O'zbek tilida (lotin) yoz. Faqat JSON qaytar.",
        `Quyidagi matn asosida bitta qisqa savol va 4 ta variant tuz (bittasi to'g'ri, qolganlari ishonarli lekin noto'g'ri). JSON: {"q":"","options":["","","",""],"answer":0,"explain":"1 jumla"}. Matn:\n${b.text}`);
      const correct = out.options[out.answer];
      out.options.sort(() => Math.random() - 0.5);
      out.answer = out.options.indexOf(correct);
      return J(out);
    }
    return J({ error: "Noma'lum amal" }, 400);
  } catch (e) { return J({ error: e.message }, 500); }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api" && request.method === "POST") return handle({ request, env });
    return env.ASSETS.fetch(request);
  }
};
