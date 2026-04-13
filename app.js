(function () {
  "use strict";

  var THEME_MAP = {
    DodgerBlue: "#1e90ff",
    dodgerblue: "#1e90ff",
  };

  window.__latestProfile = null;
  var hasPopulatedOnce = false;

  function setPageLoading(isLoading) {
    document.body.classList.toggle("app-loading", !!isLoading);
  }

  function emptyProfile() {
    return {
      theme_color: "#1e90ff",
      companyname: "",
      firstname: "",
      designation: "",
      email: "",
      phonenumber: "",
      countrycode: "+91",
      whatsupno: "",
      address: "",
      logo: "",
      establishedyear: "",
      otherbusiness: "",
      about: "",
      services: [],
      googlepay: "",
      paytm: "",
      paytm_QRcode: "",
      gallery_images: [],
      videos: [],
      googlemap: "",
      website_url: "",
      facebook: "",
      twitter: "",
      linkedin: "",
      youtube: "",
      instagram: "",
      custom_links: [],
      profile_link: window.location.href,
      view_count: 0,
    };
  }

  function showToast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(function () {
      el.classList.add("is-visible");
    });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      el.classList.remove("is-visible");
      setTimeout(function () {
        el.hidden = true;
      }, 350);
    }, 2200);
  }

  function escapeVcard(s) {
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,");
  }

  function buildVcard(p) {
    var name = (p.firstname || "").trim();
    var lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:" + escapeVcard("") + ";" + escapeVcard(p.firstname || "") + ";;;",
      "FN:" + escapeVcard(name),
      "ORG:" + escapeVcard(p.companyname || ""),
      "TITLE:" + escapeVcard((p.designation || "").replace(/\s+/g, " ").trim()),
      "TEL;TYPE=CELL:" + escapeVcard((p.countrycode || "").replace(/\+/g, "") + (p.phonenumber || "")),
      "EMAIL;TYPE=INTERNET:" + escapeVcard(p.email || ""),
      "ADR;TYPE=WORK:;;" + escapeVcard(p.address || "") + ";;;;",
      "URL:" + escapeVcard(p.website_url || ""),
      "NOTE:" + escapeVcard("Digital vCard — " + (p.companyname || "")),
      "END:VCARD",
    ];
    return lines.join("\r\n");
  }

  function applyTheme(themeName) {
    var hex;
    if (themeName && String(themeName).trim().charAt(0) === "#") {
      hex = String(themeName).trim();
    } else {
      hex = THEME_MAP[themeName] || THEME_MAP.DodgerBlue;
    }
    document.documentElement.style.setProperty("--theme-color", hex);
  }

  function normalizeUrl(u) {
    if (!u) return "#";
    u = String(u).trim();
    if (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("mailto:") || u.startsWith("tel:")) return u;
    return "https://" + u.replace(/^\/+/, "");
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function parseVideoUrl(raw) {
    var u = String(raw || "").trim();
    if (!u) return null;
    var yt = u.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/
    );
    if (yt) return { kind: "iframe", src: "https://www.youtube.com/embed/" + yt[1] };
    var vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vm) return { kind: "iframe", src: "https://player.vimeo.com/video/" + vm[1] };
    if (/\.(mp4|webm)(\?.*)?$/i.test(u)) return { kind: "video", src: u };
    return { kind: "external", href: normalizeUrl(u) };
  }

  function stripHtmlText(s) {
    if (!s) return "";
    var d = document.createElement("div");
    d.innerHTML = s;
    return (d.textContent || "").replace(/\s+/g, " ").trim();
  }

  function syncNavToSections() {
    var i;
    for (i = 1; i <= 7; i++) {
      var step = document.getElementById("step" + i);
      var hide = !!(step && step.classList.contains("d-none"));
      document.querySelectorAll('.nav-scroll[data-target="step' + i + '"]').forEach(function (a) {
        var li = a.closest("li");
        if (li) li.classList.toggle("d-none", hide);
      });
    }
  }

  function applyContentVisibility(p, PV) {
    var co = (p.companyname || "").trim();
    var fn = (p.firstname || "").trim();
    var des = (p.designation || "").trim();
    var em = (p.email || "").trim();
    var addr = (p.address || "").trim();
    var web = (p.website_url || "").trim();
    var cc = (p.countrycode || "+91").replace(/\s/g, "");
    var phone = (p.phonenumber || "").replace(/\s/g, "");
    var waLineVal = (p.whatsupno || phone || "").trim();
    var mapUrl = (p.googlemap || "").trim();
    var waDigits = (p.whatsupno || phone).replace(/\D/g, "");
    if (waDigits.length === 10 && !waDigits.startsWith("91")) waDigits = "91" + waDigits;

    var viewsRow = document.getElementById("views-row");
    if (viewsRow) viewsRow.classList.toggle("d-none", PV);

    var personEl = document.getElementById("person-name");
    if (personEl) {
      personEl.classList.toggle("d-none", !fn);
      personEl.classList.remove("preview-placeholder");
    }
    var desEl = document.getElementById("designation");
    if (desEl) {
      desEl.classList.toggle("d-none", !des);
      desEl.classList.remove("preview-placeholder");
    }
    var hrMain = document.getElementById("hr-main-title");
    if (hrMain) hrMain.classList.toggle("d-none", !fn && !des);

    var addrRow = document.querySelector(".info .address");
    if (addrRow) addrRow.classList.toggle("d-none", !addr);
    var emRow = document.querySelector(".info .email");
    if (emRow) emRow.classList.toggle("d-none", !em);
    var webRow = document.getElementById("web-link") && document.getElementById("web-link").closest(".phone");
    if (webRow) webRow.classList.toggle("d-none", !web);

    var phoneCols = document.querySelectorAll("#step1 .info .row .col-sm-6");
    if (phoneCols[0]) phoneCols[0].classList.toggle("d-none", !phone);
    if (phoneCols[1]) phoneCols[1].classList.toggle("d-none", !waLineVal);

    var btnTel = document.getElementById("btn-tel");
    var btnWa = document.getElementById("btn-wa");
    var btnMap = document.getElementById("btn-map");
    var btnMail = document.getElementById("btn-mail");
    if (btnTel) btnTel.classList.toggle("d-none", !phone);
    if (btnWa) btnWa.classList.toggle("d-none", !waDigits);
    if (btnMap) btnMap.classList.toggle("d-none", !mapUrl);
    if (btnMail) btnMail.classList.toggle("d-none", !em);

    var socialBar = document.querySelector("#step1 .social-media");
    if (socialBar) {
      var anyBtn = phone || waDigits || mapUrl || em;
      socialBar.classList.toggle("d-none", !anyBtn);
    }

    var customs = Array.isArray(p.custom_links) ? p.custom_links : [];
    var hasCustom = customs.some(function (c) {
      return c && String(c.url || "").trim();
    });
    var hasSocial = [p.facebook, p.twitter, p.linkedin, p.youtube, p.instagram].some(function (x) {
      return x && String(x).trim();
    });
    hasSocial = hasSocial || hasCustom;
    var socialRow = document.getElementById("social-row");
    if (socialRow) socialRow.classList.toggle("d-none", !hasSocial);

    var est = (p.establishedyear || "").trim();
    var nat = (p.otherbusiness || "").trim();
    var abText = stripHtmlText(p.about || "");
    var acRow = document.getElementById("about-row-company");
    var ayRow = document.getElementById("about-row-year");
    var anRow = document.getElementById("about-row-nature");
    var abBody = document.getElementById("about-row-body");
    if (acRow) acRow.classList.toggle("d-none", !co);
    if (ayRow) ayRow.classList.toggle("d-none", !est);
    if (anRow) anRow.classList.toggle("d-none", !nat);
    if (abBody) abBody.classList.toggle("d-none", !abText);
    var step2 = document.getElementById("step2");
    if (step2) step2.classList.toggle("d-none", !co && !est && !nat && !abText);

    var svcList = p.services || [];
    var step3 = document.getElementById("step3");
    if (step3) step3.classList.toggle("d-none", svcList.length === 0);

    var gpay = (p.googlepay || "").trim();
    var ptm = (p.paytm || "").trim();
    var pqr = (p.paytm_QRcode || "").trim();
    var step4 = document.getElementById("step4");
    if (step4) step4.classList.toggle("d-none", !gpay && !ptm && !pqr);
    var gpayRow = document.getElementById("gpay-no") && document.getElementById("gpay-no").closest(".row");
    var paytmRow = document.getElementById("paytm-no") && document.getElementById("paytm-no").closest(".row");
    if (gpayRow) gpayRow.classList.toggle("d-none", !gpay);
    if (paytmRow) paytmRow.classList.toggle("d-none", !ptm);
    var paytmQrCol =
      document.getElementById("paytm-qr") && document.getElementById("paytm-qr").closest(".col-md-6");
    if (paytmQrCol) paytmQrCol.classList.toggle("d-none", !pqr);

    var logoUrl = (p.logo || "").trim();
    var lw = document.querySelector("#step1 .logo-wrap");
    if (lw) lw.classList.toggle("d-none", !logoUrl);

    var gimgs = p.gallery_images || [];
    var step5 = document.getElementById("step5");
    if (step5) step5.classList.toggle("d-none", gimgs.length === 0);

    var vids = p.videos;
    var hasVideos = false;
    if (Array.isArray(vids)) {
      hasVideos = vids.some(function (v) {
        var u = typeof v === "string" ? v : v && v.url;
        return u && String(u).trim();
      });
    }
    var step6 = document.getElementById("step6");
    if (step6) step6.classList.toggle("d-none", !hasVideos);

    syncNavToSections();
  }

  function populate(p) {
    p = p || emptyProfile();
    window.__latestProfile = p;
    var PV = !!p.__preview;

    function D(val, fallback) {
      var empty = val == null || String(val).trim() === "";
      if (PV && empty) return { t: fallback, ph: true };
      return { t: String(val || ""), ph: false };
    }

    function setText(id, val, fallback) {
      var o = D(val, fallback);
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = o.t;
      el.classList.toggle("preview-placeholder", o.ph);
    }

    applyTheme(p.theme_color || "#1e90ff");

    var co = (p.companyname || "").trim();
    var fn = (p.firstname || "").trim();
    if (PV && !co && !fn) {
      document.title = "Preview — Digital vCard";
    } else {
      var titleBits = [];
      if (fn) titleBits.push(fn);
      if (co) titleBits.push(co);
      document.title = titleBits.length ? titleBits.join(" — ") : "Card";
    }

    var vcNum = Number(p.view_count);
    if (Number.isNaN(vcNum)) vcNum = 0;
    setText("view-count", String(vcNum), "0");

    var imgEl = document.getElementById("profile-logo");
    var logoPh = document.getElementById("logo-placeholder");
    var logoUrl = (p.logo || "").trim();
    if (logoUrl) {
      imgEl.src = logoUrl;
      imgEl.classList.remove("d-none");
      imgEl.removeAttribute("hidden");
      if (logoPh) logoPh.hidden = true;
    } else {
      imgEl.removeAttribute("src");
      imgEl.classList.add("d-none");
      if (logoPh) {
        logoPh.hidden = !PV;
      }
    }

    setText("person-name", p.firstname, "Your name");
    setText("designation", p.designation, "Your title or tagline");

    var cc = (p.countrycode || "+91").replace(/\s/g, "");
    var phone = (p.phonenumber || "").replace(/\s/g, "");
    var telHref = phone ? "tel:" + cc + phone : "#";
    document.getElementById("btn-tel").href = telHref;

    var waDigits = (p.whatsupno || phone).replace(/\D/g, "");
    if (waDigits.length === 10 && !waDigits.startsWith("91")) waDigits = "91" + waDigits;
    document.getElementById("btn-wa").href = waDigits ? "https://wa.me/" + waDigits : "#";

    var mapUrl = (p.googlemap || "").trim();
    document.getElementById("btn-map").href = mapUrl || "#";

    var em = (p.email || "").trim();
    document.getElementById("btn-mail").href = em ? "mailto:" + em : "#";
    var emO = D(em, "you@example.com");
    var emLink = document.getElementById("email-link");
    emLink.href = em ? "mailto:" + em : "#";
    emLink.textContent = " " + emO.t + " ";
    emLink.classList.toggle("preview-placeholder", emO.ph);

    var addrO = D(p.address, "Your address");
    var addrEl = document.getElementById("address-text");
    addrEl.textContent = " " + addrO.t + " ";
    addrEl.classList.toggle("preview-placeholder", addrO.ph);

    var web = (p.website_url || "").trim();
    var webO = D(web.replace(/^https?:\/\//i, ""), "yoursite.com");
    document.getElementById("web-link").href = web ? normalizeUrl(web) : "#";
    var webSpan = document.getElementById("web-text");
    webSpan.textContent = " " + webO.t + " ";
    webSpan.classList.toggle("preview-placeholder", webO.ph);

    var plEl = document.getElementById("phone-line");
    if (plEl) {
      plEl.textContent = phone ? cc + " " + phone : "";
      plEl.classList.remove("preview-placeholder");
    }

    var waLineVal = (p.whatsupno || phone || "").trim();
    var waEl = document.getElementById("wa-line");
    if (waEl) {
      waEl.textContent = waLineVal ? cc + " " + waLineVal + " " : "";
      waEl.classList.remove("preview-placeholder");
    }

    setText("about-company", p.companyname, "Your company name");
    setText("year-est", p.establishedyear, "Year");
    setText("nature-biz", p.otherbusiness, "Nature of business");

    var aboutHtml = (p.about || "").trim();
    var aboutEl = document.getElementById("about-html");
    if (aboutEl) {
      aboutEl.innerHTML = aboutHtml || "";
      aboutEl.classList.remove("preview-placeholder");
    }

    setText("gpay-no", p.googlepay, "—");
    setText("paytm-no", p.paytm, "—");

    var qr = document.getElementById("paytm-qr");
    var qrPh = document.getElementById("paytm-qr-ph");
    var paytmSrc = (p.paytm_QRcode || "").trim();
    if (paytmSrc) {
      qr.src = paytmSrc;
      qr.classList.remove("d-none");
      if (qrPh) qrPh.classList.add("d-none");
    } else {
      qr.removeAttribute("src");
      qr.classList.add("d-none");
      if (qrPh) qrPh.classList.add("d-none");
    }

    var shareUrl = encodeURIComponent((p.profile_link || "").trim() || window.location.href);
    var shareWrap = document.getElementById("share-buttons");
    shareWrap.innerHTML =
      '<a target="_blank" rel="noopener" href="https://api.whatsapp.com/send?text=' +
      shareUrl +
      '"><i class="fa fa-whatsapp share-button-whatsapp share_btn" aria-hidden="true"></i></a>' +
      '<a target="_blank" rel="noopener" class="fb-xfbml-parse-ignore" href="https://www.facebook.com/sharer/sharer.php?u=' +
      shareUrl +
      '"><i class="fa fa-facebook share-button-facebook share_btn" aria-hidden="true"></i></a>' +
      '<a target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=' +
      shareUrl +
      '"><i class="fa fa-twitter share-button-twitter share_btn" aria-hidden="true"></i></a>';

    var social = document.getElementById("social-row");
    social.innerHTML = "";
    if (p.facebook) {
      var a = document.createElement("a");
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "fa fa-facebook";
      a.href = normalizeUrl(p.facebook);
      social.appendChild(a);
    }
    if (p.twitter) {
      var t = document.createElement("a");
      t.target = "_blank";
      t.rel = "noopener";
      t.className = "fa fa-twitter";
      t.href = normalizeUrl(p.twitter);
      social.appendChild(t);
    }
    if (p.linkedin) {
      var l = document.createElement("a");
      l.target = "_blank";
      l.rel = "noopener";
      l.className = "fa fa-linkedin";
      l.href = normalizeUrl(p.linkedin);
      social.appendChild(l);
    }
    if (p.youtube && String(p.youtube).trim()) {
      var y = document.createElement("a");
      y.target = "_blank";
      y.rel = "noopener";
      y.className = "fa fa-youtube-play";
      y.href = normalizeUrl(p.youtube);
      social.appendChild(y);
    }
    if (p.instagram && String(p.instagram).trim()) {
      var ig = document.createElement("a");
      ig.target = "_blank";
      ig.rel = "noopener";
      ig.className = "fa fa-instagram";
      ig.href = normalizeUrl(p.instagram);
      social.appendChild(ig);
    }
    var cust = p.custom_links;
    if (Array.isArray(cust)) {
      cust.forEach(function (cl) {
        var u = (cl && cl.url && String(cl.url).trim()) || "";
        if (!u) return;
        var a = document.createElement("a");
        a.target = "_blank";
        a.rel = "noopener";
        a.href = normalizeUrl(u);
        a.className = "social-custom-link";
        a.title = (cl.label || "Link").trim();
        a.innerHTML =
          '<i class="fa fa-link" aria-hidden="true"></i> <span class="social-custom-label">' +
          escapeHtml((cl.label || "Link").trim()) +
          "</span>";
        social.appendChild(a);
      });
    }

    var servicesEl = document.getElementById("services-list");
    servicesEl.innerHTML = "";
    var svcList = p.services || [];
    svcList.forEach(function (svc) {
      var wrap = document.createElement("div");
      wrap.className = "product-services";
      var enq =
        "mailto:" +
        (em || "") +
        "?subject=" +
        encodeURIComponent("Enquiry: " + (svc.title || "")) +
        "&body=" +
        encodeURIComponent("Hello,\n\nI would like to know more about " + (svc.title || "") + ".\n");
      var fileUrl = (svc.fileUrl || "").trim();
      var customLink = (svc.link || "").trim();
      var desc = (svc.description || "").trim();
      var btnHref = customLink ? normalizeUrl(customLink) : enq;
      var btnLabel = customLink ? "Open link" : "Enquiry";
      var btnExtra = customLink ? ' target="_blank" rel="noopener"' : "";
      var imgBlock = fileUrl
        ? '<div class="card-img-top"><img class="product-img text-center" src="' +
          escapeHtml(fileUrl) +
          '" alt=""></div>'
        : "";
      var descBlock = desc
        ? '<div class="px-3 pt-2"><p class="prod_p small text-left mb-0 service-desc" style="white-space:pre-wrap;">' +
          escapeHtml(desc) +
          "</p></div>"
        : "";
      wrap.innerHTML =
        '<div class="card bg-light mt-3">' +
        '<div class="card-header text-center"><h6 class="font-weight-xl">' +
        escapeHtml(svc.title || "") +
        "</h6></div>" +
        imgBlock +
        descBlock +
        '<div class="bg_white text-center py-3">' +
        '<a class="btn btn-sm enuery cursor-pointer" href="' +
        escapeHtml(btnHref) +
        '"' +
        btnExtra +
        ' style="background: var(--theme-color); color: white; font-weight: 600;">' +
        escapeHtml(btnLabel) +
        "</a>" +
        "</div></div>";
      servicesEl.appendChild(wrap);
    });

    var gallery = document.getElementById("gallery-row");
    gallery.innerHTML = "";
    var gimgs = p.gallery_images || [];
    gimgs.forEach(function (g, idx) {
      var col = document.createElement("div");
      col.className = "col-sm-4 mt-3 gallery_imgs";
      var img = document.createElement("img");
      img.className = "img-responsive img-fluid galery_img";
      img.alt = "Image " + (idx + 1);
      img.src = (g && g.src) || g || "";
      col.appendChild(img);
      gallery.appendChild(col);
    });

    var videosEl = document.getElementById("videos-row");
    if (videosEl) {
      videosEl.innerHTML = "";
      var videoList = p.videos || [];
      videoList.forEach(function (entry) {
        var url = typeof entry === "string" ? entry : entry && entry.url;
        url = (url || "").trim();
        if (!url) return;
        var parsed = parseVideoUrl(url);
        if (!parsed) return;
        var col = document.createElement("div");
        col.className = "col-12 mb-3";
        if (parsed.kind === "iframe") {
          col.innerHTML =
            '<div class="embed-responsive embed-responsive-16by9 rounded overflow-hidden bg-dark">' +
            '<iframe class="embed-responsive-item" src="' +
            escapeHtml(parsed.src) +
            '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy" title="Video"></iframe>' +
            "</div>";
        } else if (parsed.kind === "video") {
          col.innerHTML =
            '<video class="w-100 rounded" controls playsinline preload="metadata" src="' +
            escapeHtml(parsed.src) +
            '"></video>';
        } else {
          col.innerHTML =
            '<a class="btn btn-block text-white py-2" style="background:var(--theme-color);font-weight:600;" href="' +
            escapeHtml(parsed.href) +
            '" target="_blank" rel="noopener"><i class="fa fa-external-link mr-2"></i>Open video</a>';
        }
        videosEl.appendChild(col);
      });
    }

    var profileLink = (p.profile_link || "").trim() || window.location.href;
    var qrHost = document.getElementById("qrcode");
    qrHost.innerHTML = "";
    if (window.QRCode) {
      new window.QRCode(qrHost, {
        text: profileLink,
        width: 164,
        height: 164,
      });
    }

    applyContentVisibility(p, PV);
    if (!hasPopulatedOnce) {
      hasPopulatedOnce = true;
      setPageLoading(false);
    }
  }

  function initNavScroll() {
    var links = document.querySelectorAll(".nav-scroll");

    function setActive(id) {
      links.forEach(function (a) {
        var t = a.getAttribute("data-target");
        a.classList.toggle("active", t === id);
      });
    }

    links.forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var id = a.getAttribute("data-target");
        var el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          setActive(id);
        }
      });
    });

    window.addEventListener("scroll", function () {
      var order = ["step1", "step2", "step3", "step4", "step5", "step6", "step7"];
      var y = window.scrollY + 120;
      var current = "step1";
      order.forEach(function (id) {
        var sec = document.getElementById(id);
        if (sec && !sec.classList.contains("d-none") && sec.offsetTop <= y) current = id;
      });
      setActive(current);
    });

    setActive("step1");
  }

  function setupCardInteractionsOnce() {
    if (window.__cardInteractionsBound) return;
    window.__cardInteractionsBound = true;

    var qrHost = document.getElementById("qrcode");

    document.getElementById("btn-vcard").addEventListener("click", function () {
      var p = window.__latestProfile;
      if (!p) return;
      var blob = new Blob([buildVcard(p)], { type: "text/vcard;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "contact.vcf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Contact card downloaded");
    });

    document.getElementById("btn-qr-dl").addEventListener("click", function () {
      var canvas = qrHost.querySelector("canvas");
      if (!canvas) return;
      canvas.toBlob(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "vcard-qr.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("QR code saved");
      });
    });

    document.getElementById("enquiry-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var p = window.__latestProfile;
      if (!p) return;
      var name = document.getElementById("enqirer_name").value.trim();
      var mob = document.getElementById("mobile_number").value.trim();
      var msg = document.getElementById("messages").value.trim();
      var body =
        "Name: " +
        name +
        "\nMobile: " +
        mob +
        "\n\nMessage:\n" +
        msg +
        "\n\n— Sent from digital vCard";
      window.location.href =
        "mailto:" + (p.email || "") + "?subject=" + encodeURIComponent("Enquiry from vCard") + "&body=" + encodeURIComponent(body);
    });

    initNavScroll();
  }

  function tryEmbedded() {
    var el = document.getElementById("profile-embedded");
    if (!el || !el.textContent.trim()) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      return null;
    }
  }

  function load() {
    setupCardInteractionsOnce();

    var url = new URL(window.location.href);
    var preview = url.searchParams.get("preview") === "1";

    if (preview) {
      setPageLoading(false);
      window.addEventListener("message", function (ev) {
        if (!ev.data || ev.data.type !== "profile-update" || !ev.data.profile) return;
        populate(ev.data.profile);
      });
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "card-ready" }, "*");
      }
      return;
    }

    var path = url.pathname.replace(/^\/+|\/+$/g, "");
    var firstSeg = path.split("/")[0];
    setPageLoading(true);
    if (firstSeg) {
      fetch("/api/profile/" + encodeURIComponent(firstSeg))
        .then(function (r) {
          if (r.status === 404) throw new Error("not found");
          if (!r.ok) throw new Error("bad status");
          return r.json();
        })
        .then(populate)
        .catch(function () {
          showToast("Card not found");
          populate(emptyProfile());
        });
      return;
    }

    fetch("profile-data.json")
      .then(function (r) {
        if (!r.ok) throw new Error("bad status");
        return r.json();
      })
      .then(populate)
      .catch(function () {
        var data = tryEmbedded();
        if (data) populate(data);
        else {
          showToast("Add profile-embedded JSON or run a local server");
          populate(emptyProfile());
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
