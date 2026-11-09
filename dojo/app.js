(function () {
  var BANKS = {
    marketing: { meta: DOJO_META, questions: QUESTIONS },
    public: { meta: PUBLIC_META, questions: PUBLIC_QUESTIONS }
  };
  var KIND_LABEL = { blank: "穴埋め", calc: "計算", essay: "論述" };
  var MODES = [
    ["order", "順番"],
    ["random", "ランダム"],
    ["unseen", "未解答"],
    ["wrong", "まちがえた問題"]
  ];

  var SYNC_URL = "https://mjattwfxzpefgklbqlpz.supabase.co/rest/v1/rpc/";
  var SYNC_APIKEY = "sb_publishable_d5SnRIbuJGfntfjOObIWWw_iKR0GOt9";
  var syncDirty = {};
  var syncTimer = null;
  var syncRunning = false;
  var syncAgain = false;
  var syncError = "";
  var syncedAt = null;

  var bankId = localStorage.getItem("dojo-active-bank") || "marketing";
  if (!BANKS[bankId]) bankId = "marketing";

  var saved = load(BANKS[bankId].meta.storageKey);
  var state = {
    bank: bankId,
    chapter: saved.ui && saved.ui.chapter != null ? saved.ui.chapter : BANKS[bankId].meta.defaultChapter,
    kind: saved.ui && saved.ui.kind ? saved.ui.kind : "all",
    mode: saved.ui && saved.ui.mode ? saved.ui.mode : "order",
    cursor: saved.ui && saved.ui.cursor ? saved.ui.cursor : 0,
    order: saved.ui && saved.ui.order ? saved.ui.order : null,
    status: "idle",
    editing: null
  };
  var progress = saved.progress || {};
  var edits = loadEdits();
  var merged = [];
  var view = [];

  var app = document.getElementById("app");
  app.innerHTML =
    '<div class="subjects" id="subjects"></div>' +
    '<header class="top">' +
      '<div>' +
        '<p class="eyebrow" id="eyebrow"></p>' +
        '<h1 id="title"></h1>' +
        '<p class="lede" id="lede"></p>' +
        '<ul class="scope" id="scope"></ul>' +
      '</div>' +
      '<div class="score" id="score"></div>' +
    '</header>' +
    '<div class="filters" id="chapters"></div>' +
    '<div class="filters" id="kinds"></div>' +
    '<div class="filters" id="modes"></div>' +
    '<main class="card" id="card"></main>' +
    '<div class="side">' +
      '<ul class="weak" id="weak"></ul>' +
      '<div class="tools">' +
        '<button type="button" id="sync"></button>' +
        '<button type="button" id="restore"></button>' +
        '<button type="button" id="copy">記録をコピー</button>' +
        '<button type="button" id="reset">記録を消す</button>' +
      '</div>' +
    '</div>' +
    '<p class="foot" id="foot"></p>';

  document.getElementById("restore").addEventListener("click", restoreRemoved);
  document.getElementById("copy").addEventListener("click", copyStats);
  document.getElementById("reset").addEventListener("click", resetStats);
  document.getElementById("sync").addEventListener("click", onSyncClick);
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") syncAll();
    else runSync();
  });
  window.addEventListener("online", syncAll);

  applyEdits();
  renderChrome();
  rebuild();
  renderSyncLabel();
  syncAll();

  function meta() { return BANKS[state.bank].meta; }
  function qs() { return merged; }
  function qKind(q) { return q.kind || "blank"; }

  function load(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch (e) {
      return {};
    }
  }

  function loadEdits() {
    var e = load(meta().storageKey + "-edits");
    return { changed: e.changed || {}, added: e.added || [], removed: e.removed || [] };
  }

  function saveEdits() {
    try {
      localStorage.setItem(meta().storageKey + "-edits", JSON.stringify(edits));
    } catch (e) {}
  }

  function applyEdits() {
    merged = BANKS[state.bank].questions.filter(function (q) {
      return edits.removed.indexOf(q.id) === -1;
    }).map(function (q) {
      return edits.changed[q.id] ? Object.assign({}, q, edits.changed[q.id]) : q;
    }).concat(edits.added);
  }

  function persist() {
    try {
      localStorage.setItem("dojo-active-bank", state.bank);
      localStorage.setItem(meta().storageKey, JSON.stringify({
        progress: progress,
        ui: {
          chapter: state.chapter,
          kind: state.kind,
          mode: state.mode,
          cursor: state.cursor,
          order: state.order
        }
      }));
    } catch (e) {}
    if (hasUnsyncedChange(state.bank)) syncSoon();
  }

  function switchBank(id) {
    if (id === state.bank) return;
    persist();
    state.bank = id;
    var next = load(meta().storageKey);
    progress = next.progress || {};
    edits = loadEdits();
    applyEdits();
    state.chapter = next.ui && next.ui.chapter != null ? next.ui.chapter : meta().defaultChapter;
    state.kind = next.ui && next.ui.kind ? next.ui.kind : "all";
    state.mode = next.ui && next.ui.mode ? next.ui.mode : "order";
    state.cursor = next.ui && next.ui.cursor ? next.ui.cursor : 0;
    state.order = next.ui && next.ui.order ? next.ui.order : null;
    state.status = "idle";
    rebuild();
  }

  function poolChapters() {
    return meta().chapterOrder.indexOf(state.chapter) === -1 && state.chapter !== 0
      ? meta().defaultChapter
      : state.chapter;
  }

  function computePool() {
    state.chapter = poolChapters();
    var list = qs().filter(function (q) {
      if (state.chapter !== 0 && q.chapter !== state.chapter) return false;
      if (state.kind !== "all" && qKind(q) !== state.kind) return false;
      return true;
    });
    if (state.mode === "wrong") {
      list = list.filter(function (q) {
        return progress[q.id] && progress[q.id].latest === "ng";
      });
    } else if (state.mode === "unseen") {
      list = list.filter(function (q) {
        return !progress[q.id];
      });
    }
    if (state.mode === "random") {
      var ids = list.map(function (q) { return q.id; });
      var known = state.order;
      var same = known && known.length === ids.length && known.every(function (id) {
        return ids.indexOf(id) !== -1;
      });
      if (!same) state.order = shuffle(ids);
      var map = {};
      list.forEach(function (q) { map[q.id] = q; });
      list = state.order.map(function (id) { return map[id]; }).filter(Boolean);
    }
    return list;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function rebuild() {
    view = computePool();
    if (!view.length) state.cursor = 0;
    else if (state.cursor >= view.length) state.cursor = 0;
    else if (state.cursor < 0) state.cursor = view.length - 1;
    state.status = "idle";
    state.editing = null;
    persist();
    renderChrome();
    renderCard();
  }

  function kindsInBank() {
    var seen = {};
    qs().forEach(function (q) { seen[qKind(q)] = true; });
    return Object.keys(seen);
  }

  function renderChrome() {
    document.title = meta().subject + "問題道場";
    document.getElementById("eyebrow").textContent = meta().eyebrow;
    document.getElementById("title").textContent = meta().subject + "問題道場";
    document.getElementById("lede").textContent = meta().lede;

    var subjects = document.getElementById("subjects");
    subjects.innerHTML = "";
    Object.keys(BANKS).forEach(function (id) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = BANKS[id].meta.subject;
      if (id === state.bank) btn.className = "on";
      btn.addEventListener("click", function () { switchBank(id); });
      subjects.appendChild(btn);
    });

    var scope = document.getElementById("scope");
    scope.innerHTML = "";
    meta().files.forEach(function (name) {
      var li = document.createElement("li");
      li.textContent = name;
      scope.appendChild(li);
    });

    var totals = tally(null);
    document.getElementById("score").innerHTML =
      "<b>" + (totals.attempts ? Math.round(100 * totals.correct / totals.attempts) : "–") + (totals.attempts ? "<span style=\"font-size:22px\">%</span>" : "") + "</b>" +
      "<span>正答率 · " + totals.correct + "/" + totals.attempts + " 回</span>";

    var chapters = document.getElementById("chapters");
    chapters.innerHTML = "";
    meta().chapterOrder.concat([0]).forEach(function (ch) {
      var info = tally(ch === 0 ? null : ch);
      var count = qs().filter(function (q) { return ch === 0 || q.chapter === ch; }).length;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = state.chapter === ch ? "on" : "";
      btn.innerHTML = (ch === 0 ? "すべて" : "第" + ch + "章 " + meta().chapters[ch]) +
        "<small>" + info.mastered + "/" + count + " 習得" +
        (info.attempts ? " · " + Math.round(100 * info.correct / info.attempts) + "%" : "") + "</small>";
      btn.addEventListener("click", function () {
        state.chapter = ch;
        state.cursor = 0;
        state.order = null;
        rebuild();
      });
      chapters.appendChild(btn);
    });

    var kinds = document.getElementById("kinds");
    kinds.innerHTML = "";
    var present = kindsInBank();
    if (present.length > 1) {
      [["all", "形式すべて"]].concat(present.map(function (k) { return [k, KIND_LABEL[k] || k]; })).forEach(function (pair) {
        var count = qs().filter(function (q) {
          if (state.chapter !== 0 && q.chapter !== state.chapter) return false;
          return pair[0] === "all" || qKind(q) === pair[0];
        }).length;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = state.kind === pair[0] ? "on" : "";
        btn.innerHTML = pair[1] + "<small>" + count + "問</small>";
        btn.addEventListener("click", function () {
          state.kind = pair[0];
          state.cursor = 0;
          state.order = null;
          rebuild();
        });
        kinds.appendChild(btn);
      });
    }

    var modes = document.getElementById("modes");
    modes.innerHTML = "";
    MODES.forEach(function (pair) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = pair[1];
      if (state.mode === pair[0]) btn.className = "on";
      btn.addEventListener("click", function () {
        state.mode = pair[0];
        state.cursor = 0;
        state.order = null;
        rebuild();
      });
      modes.appendChild(btn);
    });

    var weak = document.getElementById("weak");
    weak.innerHTML = "";
    qs().filter(function (q) {
      return progress[q.id] && progress[q.id].latest === "ng";
    }).forEach(function (q) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = q.id + " " + q.topic;
      btn.addEventListener("click", function () {
        state.chapter = q.chapter;
        state.kind = "all";
        state.mode = "order";
        state.order = null;
        view = computePool();
        var idx = view.findIndex(function (item) { return item.id === q.id; });
        state.cursor = idx === -1 ? 0 : idx;
        state.status = "idle";
        state.editing = null;
        persist();
        renderChrome();
        renderCard();
      });
      li.appendChild(btn);
      weak.appendChild(li);
    });

    var restore = document.getElementById("restore");
    restore.textContent = "消した問題を戻す（" + edits.removed.length + "）";
    restore.style.display = edits.removed.length ? "" : "none";

    document.getElementById("foot").textContent =
      "更新 " + meta().updated + " · 全" + qs().length + "問 · 出典は上のファイル。答えを見ると×。紙に書けていれば「書けていた」で○。Enter は、見る前なら答え、見た後なら次へ。";
  }

  function tally(chapter) {
    var attempts = 0;
    var correct = 0;
    var mastered = 0;
    qs().forEach(function (q) {
      if (chapter != null && q.chapter !== chapter) return;
      var r = progress[q.id];
      if (!r) return;
      attempts += r.attempts;
      correct += r.correct;
      if (r.latest === "ok") mastered += 1;
    });
    return { attempts: attempts, correct: correct, mastered: mastered };
  }

  function renderCard() {
    var card = document.getElementById("card");
    card.innerHTML = "";
    if (state.editing) {
      renderEditor(card);
      return;
    }
    if (!view.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = state.mode === "wrong"
        ? "まちがえた問題はありません。"
        : state.mode === "unseen"
          ? "未解答の問題はありません。"
          : "この範囲の問題はありません。";
      card.appendChild(empty);
      var emptyActions = document.createElement("div");
      emptyActions.className = "actions";
      emptyActions.appendChild(button("問題を追加", "ghost", openAdd));
      card.appendChild(emptyActions);
      return;
    }

    var q = view[state.cursor];
    var metaRow = document.createElement("div");
    metaRow.className = "meta";
    var left = document.createElement("span");
    left.textContent = "第" + q.chapter + "章 · " + (state.cursor + 1) + " / " + view.length;
    var right = document.createElement("span");
    var rec = progress[q.id];
    right.textContent = rec
      ? "この問題 " + rec.correct + "/" + rec.attempts + (rec.latest === "ok" ? " · 前回は正解" : " · 前回は不正解")
      : q.id;
    metaRow.appendChild(left);
    metaRow.appendChild(right);

    var topic = document.createElement("h2");
    topic.className = "topic";
    topic.textContent = q.topic;
    var badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = KIND_LABEL[qKind(q)] || "穴埋め";
    topic.appendChild(badge);

    var file = document.createElement("p");
    file.className = "fileline";
    file.textContent = "出典: " + (q.file || "") + (q.source ? " ／ " + q.source : "");

    var prompt = document.createElement("p");
    prompt.className = "prompt";
    var parts = String(q.prompt).split(/\{\{(\d+)\}\}/);
    parts.forEach(function (part, i) {
      if (i % 2 === 0) {
        prompt.appendChild(document.createTextNode(part));
      } else {
        var blank = document.createElement("span");
        blank.className = "blank";
        blank.dataset.index = part;
        blank.setAttribute("aria-label", "空欄" + (Number(part) + 1));
        prompt.appendChild(blank);
      }
    });

    var actions = document.createElement("div");
    actions.className = "actions";
    actions.appendChild(button("答えを見る", "primary", reveal));
    actions.appendChild(button("前へ", "ghost", prev));
    actions.appendChild(button("次へ", "ghost", next));
    actions.appendChild(button("編集", "ghost edit-open", openEdit));
    actions.appendChild(button("問題を追加", "ghost", openAdd));

    card.appendChild(metaRow);
    card.appendChild(topic);
    card.appendChild(file);
    card.appendChild(prompt);
    card.appendChild(actions);
  }

  function button(label, cls, fn) {
    var el = document.createElement("button");
    el.type = "button";
    el.className = cls;
    el.textContent = label;
    el.addEventListener("click", fn);
    return el;
  }

  function fillBlanks(q, kind) {
    if (!q.answers) return;
    Array.prototype.forEach.call(document.querySelectorAll("#card .prompt .blank"), function (el) {
      var i = Number(el.dataset.index);
      el.textContent = q.answers[i][0];
      el.classList.remove("ok", "ng");
      el.classList.add(kind);
    });
  }

  function reveal() {
    if (state.status !== "idle" || !view.length) return;
    var q = view[state.cursor];
    fillBlanks(q, "ng");
    var rec = progress[q.id] || { attempts: 0, correct: 0, latest: "" };
    rec.attempts += 1;
    rec.latest = "ng";
    progress[q.id] = rec;
    state.status = "revealed";
    persist();
    showResult(q, false);
    renderChrome();
  }

  function markWritten() {
    if (state.status !== "revealed" || !view.length) return;
    var q = view[state.cursor];
    var rec = progress[q.id];
    if (rec && rec.latest === "ng") {
      rec.correct += 1;
      rec.latest = "ok";
    }
    fillBlanks(q, "ok");
    state.status = "graded";
    persist();
    showResult(q, true);
    renderChrome();
  }

  function showResult(q, ok) {
    var old = document.querySelector("#card .result");
    if (old) old.remove();
    var upgrade = document.querySelector("#card .upgrade");
    if (upgrade) upgrade.remove();

    var box = document.createElement("div");
    box.className = "result";
    var stamp = document.createElement("div");
    stamp.className = "stamp " + (ok ? "ok" : "ng");
    stamp.textContent = ok ? "○" : "×";
    box.appendChild(stamp);

    if (q.model) {
      var heading = document.createElement("p");
      heading.className = "explain";
      heading.textContent = "模範解答";
      var model = document.createElement("p");
      model.className = "model";
      model.textContent = q.model;
      box.appendChild(heading);
      box.appendChild(model);
    }
    if (q.points && q.points.length) {
      var list = document.createElement("ul");
      list.className = "points";
      q.points.forEach(function (item) {
        var li = document.createElement("li");
        li.textContent = item;
        list.appendChild(li);
      });
      box.appendChild(list);
    }

    if (q.explain) {
      var explain = document.createElement("p");
      explain.className = "explain";
      explain.textContent = q.explain;
      box.appendChild(explain);
    }
    document.getElementById("card").appendChild(box);

    if (!ok) {
      document.querySelector("#card .actions").insertBefore(button("書けていた", "ghost upgrade", markWritten), document.querySelector("#card .edit-open"));
    }
  }

  function openEdit() {
    if (!view.length) return;
    state.editing = view[state.cursor].id;
    renderCard();
  }

  function openAdd() {
    state.editing = "new";
    renderCard();
  }

  function closeEditor() {
    state.editing = null;
    state.status = "idle";
    renderCard();
    syncSoon();
  }

  function isAdded(id) {
    return edits.added.some(function (q) { return q.id === id; });
  }

  function toEditable(q) {
    return String(q.prompt).replace(/\{\{(\d+)\}\}/g, function (m, i) {
      return "【" + (q.answers && q.answers[i] ? q.answers[i][0] : "") + "】";
    });
  }

  // 別解は表示に使わないが、同じ答えの穴には元の配列をそのまま残す。
  function parseEditable(text, q) {
    var old = {};
    ((q && q.answers) || []).forEach(function (a) { old[a[0]] = a; });
    var answers = [];
    var empty = false;
    var prompt = text.replace(/【([^【】]*)】/g, function (m, word) {
      word = word.trim();
      if (!word) empty = true;
      answers.push(old[word] || [word]);
      return "{{" + (answers.length - 1) + "}}";
    });
    if (empty) return { error: "中身が空の【】があります。" };
    if (/[【】]/.test(prompt)) return { error: "【 と 】の数が合っていません。" };
    return { prompt: prompt, answers: answers };
  }

  function field(label, control) {
    var wrap = document.createElement("label");
    wrap.className = "field";
    var name = document.createElement("span");
    name.textContent = label;
    wrap.appendChild(name);
    wrap.appendChild(control);
    return wrap;
  }

  function renderEditor(card) {
    var adding = state.editing === "new";
    var q = adding ? null : qs().filter(function (item) { return item.id === state.editing; })[0];

    var heading = document.createElement("h2");
    heading.className = "topic";
    heading.textContent = adding ? "問題を追加" : "問題を編集 · " + q.id;

    var topic = document.createElement("input");
    topic.type = "text";
    topic.value = q ? q.topic : "";
    topic.placeholder = "空なら最初の穴の答えになる";

    var chapter = document.createElement("select");
    meta().chapterOrder.forEach(function (ch) {
      var option = document.createElement("option");
      option.value = ch;
      option.textContent = "第" + ch + "章 " + meta().chapters[ch];
      chapter.appendChild(option);
    });
    chapter.value = q ? q.chapter : (state.chapter || meta().defaultChapter);

    var area = document.createElement("textarea");
    area.rows = 6;
    area.value = q ? toEditable(q) : "";
    area.placeholder = "例: 組織経営の課題は【顧客の創造】にある。";
    area.addEventListener("input", renderChips);

    var note = document.createElement("p");
    note.className = "hint";
    note.textContent = "【】で囲んだ所が穴になる。文字を選んで下のボタンを押してもいい。";

    var make = button("選んだ部分を穴にする", "ghost", makeBlank);
    make.addEventListener("mousedown", function (e) { e.preventDefault(); });

    var chips = document.createElement("ul");
    chips.className = "chips";

    var explain = document.createElement("textarea");
    explain.rows = 3;
    explain.value = q && q.explain ? q.explain : "";

    var message = document.createElement("p");
    message.className = "form-error";

    var actions = document.createElement("div");
    actions.className = "actions";
    actions.appendChild(button("保存", "primary", save));
    actions.appendChild(button("やめる", "ghost", closeEditor));
    if (!adding) {
      if (edits.changed[q.id]) actions.appendChild(button("元の問題に戻す", "ghost", revert));
      actions.appendChild(button("この問題を消す", "ghost danger", remove));
    }

    card.appendChild(heading);
    card.appendChild(field("論点", topic));
    card.appendChild(field("章", chapter));
    card.appendChild(field("問題文", area));
    card.appendChild(note);
    card.appendChild(make);
    card.appendChild(chips);
    card.appendChild(field("解説（なくてもいい）", explain));
    card.appendChild(message);
    card.appendChild(actions);
    renderChips();

    function renderChips() {
      chips.innerHTML = "";
      var index = 0;
      area.value.replace(/【([^【】]*)】/g, function (m, word) {
        var li = document.createElement("li");
        var mine = index;
        li.appendChild(button((word || "（空）") + " ×", "chip", function () { removeBlank(mine); }));
        chips.appendChild(li);
        index += 1;
        return m;
      });
    }

    function makeBlank() {
      var from = area.selectionStart;
      var to = area.selectionEnd;
      var text = area.value;
      var before = text.slice(0, from);
      var insideBlank = before.split("【").length > before.split("】").length;
      var picked = text.slice(from, to);
      if (from === to) {
        message.textContent = "穴にしたい文字を先に選んでください。";
        return;
      }
      if (insideBlank || /[【】]/.test(picked)) {
        message.textContent = "すでに穴になっている所は選べません。";
        return;
      }
      message.textContent = "";
      area.value = before + "【" + picked + "】" + text.slice(to);
      area.setSelectionRange(to + 2, to + 2);
      renderChips();
    }

    function removeBlank(target) {
      var index = 0;
      area.value = area.value.replace(/【([^【】]*)】/g, function (m, word) {
        return index++ === target ? word : m;
      });
      message.textContent = "";
      renderChips();
    }

    function save() {
      var parsed = parseEditable(area.value.trim(), q);
      if (parsed.error) {
        message.textContent = parsed.error;
        return;
      }
      if (!parsed.prompt) {
        message.textContent = "問題文を入れてください。";
        return;
      }
      if (!parsed.answers.length && !(q && q.model)) {
        message.textContent = "穴が1つもありません。問題ごとなくすなら「この問題を消す」を押してください。";
        return;
      }
      var values = {
        topic: topic.value.trim() || (q && q.topic) || parsed.answers[0][0],
        chapter: Number(chapter.value),
        prompt: parsed.prompt,
        answers: parsed.answers,
        explain: explain.value.trim()
      };
      var id;
      if (adding) {
        id = "my-" + Date.now().toString(36);
        edits.added.push(Object.assign({ id: id, kind: "blank", file: "自分で追加" }, values));
      } else if (isAdded(q.id)) {
        id = q.id;
        Object.assign(edits.added.filter(function (item) { return item.id === id; })[0], values);
      } else {
        id = q.id;
        edits.changed[id] = values;
      }
      commitEdits(id);
    }

    function revert() {
      delete edits.changed[q.id];
      commitEdits(q.id);
    }

    function remove() {
      if (!window.confirm("「" + q.topic + "」を消します。")) return;
      if (isAdded(q.id)) {
        edits.added = edits.added.filter(function (item) { return item.id !== q.id; });
      } else {
        delete edits.changed[q.id];
        edits.removed.push(q.id);
      }
      saveEdits();
      applyEdits();
      rebuild();
    }
  }

  // 保存した問題が今の絞り込みから外れるなら、見える範囲まで広げる。
  function commitEdits(id) {
    saveEdits();
    applyEdits();
    state.editing = null;
    view = computePool();
    var idx = view.findIndex(function (item) { return item.id === id; });
    if (idx === -1) {
      state.chapter = qs().filter(function (item) { return item.id === id; })[0].chapter;
      state.kind = "all";
      state.mode = "order";
      state.order = null;
      view = computePool();
      idx = view.findIndex(function (item) { return item.id === id; });
    }
    state.cursor = idx;
    state.status = "idle";
    persist();
    renderChrome();
    renderCard();
  }

  function restoreRemoved() {
    edits.removed = [];
    saveEdits();
    applyEdits();
    rebuild();
  }

  function next() { move(1); }
  function prev() { move(-1); }

  function move(step) {
    if (!view.length) return;
    var id = view[state.cursor] && view[state.cursor].id;
    var fresh = computePool();
    if (!fresh.length) {
      view = fresh;
      state.cursor = 0;
      state.status = "idle";
      persist();
      renderChrome();
      renderCard();
      return;
    }
    var still = fresh.findIndex(function (q) { return q.id === id; });
    if (step > 0 && still === -1) {
      state.cursor = state.cursor >= fresh.length ? 0 : state.cursor;
    } else if (still === -1) {
      state.cursor = Math.max(0, Math.min(state.cursor, fresh.length - 1));
    } else {
      state.cursor = (still + step + fresh.length) % fresh.length;
    }
    view = fresh;
    state.status = "idle";
    persist();
    renderChrome();
    renderCard();
  }

  function onKey(e) {
    if (state.editing) return;
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (state.status === "idle") {
      if (tag === "BUTTON") return;
      e.preventDefault();
      reveal();
      return;
    }
    e.preventDefault();
    next();
  }

  function syncKey() {
    try {
      return localStorage.getItem("dojo-sync-key") || "";
    } catch (e) {
      return "";
    }
  }

  function rpc(name, body) {
    return fetch(SYNC_URL + name, {
      method: "POST",
      headers: { apikey: SYNC_APIKEY, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.message || "failed");
        return data;
      });
    });
  }

  // jsonb はキーの順番を変えるので、比較はキーを並べ替えて行う。
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).sort().map(function (k) {
        return JSON.stringify(k) + ":" + canon(v[k]);
      }).join(",") + "}";
    }
    return String(JSON.stringify(v));
  }

  function union(a, b) {
    var seen = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) { seen[k] = true; });
    return Object.keys(seen);
  }

  // p: 正答記録 / c: 問題の編集 / a: 追加した問題 / r: 消した問題。項目ごとに新しい方を残す。
  function flatten(id) {
    var key = BANKS[id].meta.storageKey;
    var p = load(key).progress || {};
    var e = load(key + "-edits");
    var out = {};
    Object.keys(p).forEach(function (k) { out["p:" + k] = p[k]; });
    Object.keys(e.changed || {}).forEach(function (k) { out["c:" + k] = e.changed[k]; });
    (e.added || []).forEach(function (q) { out["a:" + q.id] = q; });
    (e.removed || []).forEach(function (k) { out["r:" + k] = true; });
    return out;
  }

  function writeFlat(id, values) {
    var key = BANKS[id].meta.storageKey;
    var saved = load(key);
    var p = {};
    var e = { changed: {}, added: [], removed: [] };
    Object.keys(values).sort().forEach(function (k) {
      var name = k.slice(2);
      if (k.charAt(0) === "p") p[name] = values[k];
      else if (k.charAt(0) === "c") e.changed[name] = values[k];
      else if (k.charAt(0) === "a") e.added.push(values[k]);
      else if (k.charAt(0) === "r") e.removed.push(name);
    });
    saved.progress = p;
    try {
      localStorage.setItem(key, JSON.stringify(saved));
      localStorage.setItem(key + "-edits", JSON.stringify(e));
    } catch (err) {}
  }

  function hasUnsyncedChange(id) {
    var shadow = load(BANKS[id].meta.storageKey + "-shadow").values || {};
    var local = flatten(id);
    return union(local, shadow).some(function (k) {
      return canon(local[k]) !== canon(shadow[k]);
    });
  }

  function adoptSynced(id) {
    if (id !== state.bank) return;
    progress = load(meta().storageKey).progress || {};
    edits = loadEdits();
    applyEdits();
    if (state.status !== "idle") {
      renderChrome();
      return;
    }
    var current = view[state.cursor] && view[state.cursor].id;
    view = computePool();
    var idx = view.findIndex(function (q) { return q.id === current; });
    if (idx !== -1) state.cursor = idx;
    else if (state.cursor >= view.length) state.cursor = 0;
    renderChrome();
    renderCard();
  }

  function syncBank(id, key, attempt) {
    return rpc("dojo_pull", { p_key: key, p_bank: id }).then(function (remote) {
      if (state.editing && id === state.bank) {
        syncDirty[id] = true;
        return;
      }
      var doc = remote.doc || {};
      var theirs = doc.values || {};
      var theirStamps = doc.stamps || {};
      var shadowKey = BANKS[id].meta.storageKey + "-shadow";
      var shadow = load(shadowKey);
      var base = shadow.values || {};
      var stamps = shadow.stamps || {};
      var local = flatten(id);
      var now = Date.now();
      union(local, base).forEach(function (k) {
        if (canon(local[k]) !== canon(base[k])) stamps[k] = now;
      });

      var values = {};
      var mergedStamps = {};
      union(stamps, theirStamps).forEach(function (k) {
        var mine = stamps[k] || 0;
        var other = theirStamps[k] || 0;
        var from = mine > other ? local : theirs;
        mergedStamps[k] = Math.max(mine, other);
        if (from[k] !== undefined) values[k] = from[k];
      });

      if (canon(values) !== canon(local)) {
        writeFlat(id, values);
        adoptSynced(id);
      }
      var next = { values: values, stamps: mergedStamps };
      try {
        localStorage.setItem(shadowKey, JSON.stringify(next));
      } catch (e) {}
      if (canon(next) === canon({ values: theirs, stamps: theirStamps })) return;

      return rpc("dojo_push", { p_key: key, p_bank: id, p_rev: remote.rev, p_doc: next }).then(function (ok) {
        if (ok) return;
        if (attempt >= 3) throw new Error("conflict");
        return syncBank(id, key, attempt + 1);
      });
    });
  }

  function syncSoon() {
    if (!syncKey()) return;
    syncDirty[state.bank] = true;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, 800);
  }

  function syncAll() {
    Object.keys(BANKS).forEach(function (id) { syncDirty[id] = true; });
    runSync();
  }

  function runSync() {
    var key = syncKey();
    if (!key) return;
    if (syncRunning) {
      syncAgain = true;
      return;
    }
    var ids = Object.keys(syncDirty);
    if (!ids.length) return;
    syncDirty = {};
    syncRunning = true;
    syncError = "";
    renderSyncLabel();
    ids.reduce(function (chain, id) {
      return chain.then(function () { return syncBank(id, key, 1); });
    }, Promise.resolve()).then(function () {
      syncedAt = new Date();
    }, function (err) {
      ids.forEach(function (id) { syncDirty[id] = true; });
      if (err.message === "bad_key") {
        try {
          localStorage.removeItem("dojo-sync-key");
        } catch (e) {}
        syncError = "合言葉が違います";
      } else {
        syncError = "同期できません（押すと再試行）";
      }
    }).then(function () {
      syncRunning = false;
      renderSyncLabel();
      if (syncAgain) {
        syncAgain = false;
        runSync();
      }
    });
  }

  function renderSyncLabel() {
    var label = "同期の設定";
    if (syncError) label = syncError;
    else if (syncRunning) label = "同期中…";
    else if (syncKey() && syncedAt) label = "同期済み " + syncedAt.getHours() + ":" + ("0" + syncedAt.getMinutes()).slice(-2);
    else if (syncKey()) label = "同期する";
    document.getElementById("sync").textContent = label;
  }

  function onSyncClick() {
    if (!syncKey()) {
      var input = window.prompt("同期の合言葉を入れてください。");
      if (!input) return;
      try {
        localStorage.setItem("dojo-sync-key", input.trim().toLowerCase());
      } catch (e) {}
    }
    syncAll();
  }

  function statsText() {
    var lines = [meta().subject + "問題道場 " + meta().updated];
    var all = tally(null);
    lines.push("正答率 " + (all.attempts ? Math.round(100 * all.correct / all.attempts) + "%（" + all.correct + "/" + all.attempts + "回）" : "まだ解答なし"));
    meta().chapterOrder.forEach(function (ch) {
      var info = tally(ch);
      var count = qs().filter(function (q) { return q.chapter === ch; }).length;
      lines.push("第" + ch + "章 習得" + info.mastered + "/" + count +
        (info.attempts ? " 正答率" + Math.round(100 * info.correct / info.attempts) + "%" : ""));
    });
    var misses = qs().filter(function (q) {
      return progress[q.id] && progress[q.id].latest === "ng";
    });
    lines.push(misses.length ? "直近が不正解: " + misses.map(function (q) { return q.id + " " + q.topic; }).join("、") : "直近が不正解の問題なし");
    return lines.join("\n");
  }

  function copyStats() {
    var text = statsText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flashCopy("コピーしました");
      }, function () {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
      flashCopy("コピーしました");
    } catch (e) {
      window.prompt("記録をコピーしてください", text);
    }
    area.remove();
  }

  function flashCopy(message) {
    var btn = document.getElementById("copy");
    var prev = btn.textContent;
    btn.textContent = message;
    setTimeout(function () { btn.textContent = prev; }, 1200);
  }

  function resetStats() {
    if (!window.confirm(meta().subject + "の正答率の記録を消します。")) return;
    progress = {};
    persist();
    rebuild();
  }
})();
