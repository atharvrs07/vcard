(function () {
  "use strict";

  var iframe;
  var debounceTimer;
  var slugCheckTimer;
  var RESERVED = {
    form: 1,
    card: 1,
    preview: 1,
    uploads: 1,
    node_modules: 1,
    "favicon.ico": 1,
  };

  var slugEditedByUser = false;
  /** Set from /config when PUBLIC_BASE_URL is configured (production). */
  var resolvedPublicBase = "";
  var query = new URLSearchParams(window.location.search);
  var editSlug = String(query.get("edit") || "").trim().toLowerCase();
  var isEditMode = !!editSlug;
  if (isEditMode) slugEditedByUser = true;

  function getPublicOrigin() {
    var o = resolvedPublicBase || window.location.origin;
    // Local dev guard: avoid https://localhost URLs when app runs on plain http.
    if (
      /^https:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(o).trim()) &&
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(window.location.origin)
    ) {
      o = window.location.origin;
    }
    return String(o).replace(/\/+$/, "");
  }

  /** Avoid JSON.parse on HTML error pages (413/502) or empty bodies from proxies. */
  function readJsonResponse(r) {
    return r.text().then(function (text) {
      var trimmed = (text || "").trim();
      if (!trimmed) {
        throw new Error(
          "Empty response from server (HTTP " +
            r.status +
            "). Check that POST /save-profile reaches Node and reverse-proxy limits allow large requests."
        );
      }
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        var head = trimmed.slice(0, 1);
        var isHtml = head === "<";
        var hint = isHtml
          ? "The server returned an HTML error page. Common causes: request body too large (raise nginx client_max_body_size and JSON_BODY_LIMIT), or a 502 from the app process."
          : trimmed.slice(0, 180);
        if (r.status === 403) {
          hint =
            "HTTP 403 is not produced by this Node app — it comes from nginx, ModSecurity, Cloudflare WAF, or your host. Whitelist POST to /save-profile (and related upload/order routes), or add a WAF exception for JSON bodies. If your server log shows no line for this POST, the request never reached Node.";
        }
        throw new Error("Could not read server response (HTTP " + r.status + "). " + hint);
      }
    });
  }

  function debounce(fn, ms) {
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        fn.apply(ctx, args);
      }, ms);
    };
  }

  function isValidSlug(s) {
    if (!s || typeof s !== "string") return false;
    var t = s.trim().toLowerCase();
    return /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(t) && !RESERVED[t];
  }

  function nameToSlug(name) {
    if (!name || typeof name !== "string") return "";
    var t = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (RESERVED[t]) t = t + "-card";
    return t.slice(0, 32).replace(/^-|-$/g, "") || "card";
  }

  function updateThemeHexLabel() {
    var pick = document.getElementById("theme_color");
    var hex = document.getElementById("theme_color_hex");
    if (pick && hex) hex.textContent = pick.value;
  }

  function updateCardUrlPreview() {
    var slug = (document.getElementById("card_slug") && document.getElementById("card_slug").value.trim().toLowerCase()) || "";
    var pre = document.getElementById("card-origin-prefix");
    if (pre) pre.textContent = getPublicOrigin() + "/";
    return slug;
  }

  function scheduleSlugStatusCheck() {
    clearTimeout(slugCheckTimer);
    slugCheckTimer = setTimeout(checkSlugStatus, 380);
  }

  function checkSlugStatus() {
    var slug = updateCardUrlPreview();
    var line = document.getElementById("slug-status-line");
    var wrap = document.getElementById("slug-suggestions-wrap");
    var sugEl = document.getElementById("slug-suggestions");
    if (!line) return;

    if (isEditMode) {
      line.innerHTML = '<span class="text-info"><i class="fa fa-pencil"></i> Editing existing card URL.</span>';
      if (wrap) wrap.hidden = true;
      return;
    }

    if (!slug) {
      line.innerHTML = '<span class="text-muted">Enter your name to generate a URL, or type a URL.</span>';
      if (wrap) wrap.hidden = true;
      return;
    }

    if (!isValidSlug(slug)) {
      line.innerHTML = '<span class="text-danger">Use lowercase letters, numbers, and single hyphens only (2–32 characters).</span>';
      if (wrap) wrap.hidden = true;
      return;
    }

    line.innerHTML = '<span class="text-muted">Checking…</span>';
    fetch("/slug-status?slug=" + encodeURIComponent(slug))
      .then(function (r) {
        return readJsonResponse(r);
      })
      .then(function (data) {
        if (!data.valid) {
          line.innerHTML = '<span class="text-danger">Invalid URL.</span>';
          renderSuggestions(data.suggestions || []);
          return;
        }
        if (data.available) {
          line.innerHTML = '<span class="text-success"><i class="fa fa-check"></i> This URL is available.</span>';
          if (wrap) wrap.hidden = true;
        } else {
          line.innerHTML = '<span class="text-warning"><i class="fa fa-warning"></i> This URL is already taken.</span>';
          renderSuggestions(data.suggestions || []);
        }
      })
      .catch(function () {
        line.innerHTML = '<span class="text-muted">Could not check availability (is the server running?).</span>';
      });
  }

  function renderSuggestions(list) {
    var wrap = document.getElementById("slug-suggestions-wrap");
    var sugEl = document.getElementById("slug-suggestions");
    if (!wrap || !sugEl) return;
    if (!list || !list.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    sugEl.innerHTML = list
      .map(function (s) {
        return (
          '<button type="button" class="btn btn-link btn-sm p-0 mr-2 slug-suggestion-btn" data-slug="' +
          String(s).replace(/"/g, "&quot;") +
          '">' +
          s +
          "</button>"
        );
      })
      .join("");
    sugEl.querySelectorAll(".slug-suggestion-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var s = btn.getAttribute("data-slug");
        var inp = document.getElementById("card_slug");
        if (inp && s) {
          inp.value = s;
          slugEditedByUser = true;
          updateCardUrlPreview();
          checkSlugStatus();
        }
      });
    });
  }

  function appendUrlToTextarea(textareaId, url) {
    var ta = document.getElementById(textareaId);
    if (!ta || !url) return;
    url = String(url).trim();
    var parts = ta.value.split(/[\n,]+/).map(function (s) {
      return s.trim();
    }).filter(Boolean);
    if (parts.indexOf(url) >= 0) return;
    ta.value = ta.value.trim() ? ta.value.trim() + "\n" + url : url;
  }

  function uploadToServer(path, fieldName, file) {
    var fd = new FormData();
    fd.append(fieldName, file);
    return fetch(path, { method: "POST", body: fd }).then(function (r) {
      return readJsonResponse(r).then(function (j) {
        if (!r.ok) throw new Error(j.error || "Upload failed");
        return j;
      });
    });
  }

  function getCustomLinksFromForm() {
    var list = [];
    document.querySelectorAll("#custom-social-rows .custom-link-row").forEach(function (row) {
      var lb = row.querySelector(".cst-label");
      var ur = row.querySelector(".cst-url");
      var label = lb && lb.value.trim();
      var u = ur && ur.value.trim();
      if (u) {
        list.push({ label: label || "Link", url: u });
      }
    });
    return list;
  }

  function addCustomLinkRow(label, url) {
    var wrap = document.getElementById("custom-social-rows");
    if (!wrap) return;
    var row = document.createElement("div");
    row.className = "custom-link-row form-row align-items-end mb-2";
    row.innerHTML =
      '<div class="col-md-5">' +
      '<label class="small text-muted mb-1">Label</label>' +
      '<input type="text" class="form-control cst-label" placeholder="e.g. Portfolio" value="' +
      escapeAttr(label || "") +
      '">' +
      "</div>" +
      '<div class="col-md-6">' +
      '<label class="small text-muted mb-1">URL</label>' +
      '<input type="url" class="form-control cst-url" placeholder="https://..." value="' +
      escapeAttr(url || "") +
      '">' +
      "</div>" +
      '<div class="col-md-1">' +
      '<button type="button" class="btn btn-sm btn-outline-danger btn-remove-cst mt-3" title="Remove">&times;</button>' +
      "</div>";
    wrap.appendChild(row);
    row.querySelector(".btn-remove-cst").addEventListener("click", function () {
      row.remove();
      sendPreview();
    });
    row.querySelectorAll("input").forEach(function (inp) {
      inp.addEventListener("input", sendPreviewDebounced);
    });
  }

  function getServicesFromForm() {
    var rows = document.querySelectorAll("#services-rows .service-row");
    var list = [];
    rows.forEach(function (row) {
      var title = row.querySelector(".svc-title");
      var img = row.querySelector(".svc-img");
      var linkEl = row.querySelector(".svc-link");
      var descEl = row.querySelector(".svc-desc");
      var t = title && title.value.trim();
      var u = img && img.value.trim();
      var lk = linkEl && linkEl.value.trim();
      var ds = descEl && descEl.value.trim();
      if (t || u || lk || ds) {
        list.push({
          type: "services",
          title: t || "Service",
          fileUrl: u || "",
          link: lk || "",
          description: ds || "",
        });
      }
    });
    return list;
  }

  function getGalleryFromForm() {
    var raw = document.getElementById("gallery_urls").value || "";
    return raw
      .split(/[\n,]+/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean)
      .map(function (src) {
        return { src: src };
      });
  }

  function getVideosFromForm() {
    var raw = (document.getElementById("video_urls") && document.getElementById("video_urls").value) || "";
    return raw
      .split(/[\n,]+/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean)
      .map(function (url) {
        return { url: url };
      });
  }

  function buildProfileFromForm() {
    var slug = (document.getElementById("card_slug") && document.getElementById("card_slug").value.trim().toLowerCase()) || "";
    var origin = getPublicOrigin();
    var themeEl = document.getElementById("theme_color");
    var themeVal = themeEl && themeEl.value ? themeEl.value.trim() : "#1e90ff";
    return {
      theme_color: themeVal,
      companyname: document.getElementById("companyname").value.trim(),
      firstname: document.getElementById("firstname").value.trim(),
      designation: document.getElementById("designation").value.trim(),
      email: document.getElementById("email").value.trim(),
      phonenumber: document.getElementById("phonenumber").value.trim(),
      countrycode: document.getElementById("countrycode").value.trim() || "+91",
      whatsupno: document.getElementById("whatsupno").value.trim(),
      address: document.getElementById("address").value.trim(),
      logo: document.getElementById("logo").value.trim(),
      establishedyear: document.getElementById("establishedyear").value.trim(),
      otherbusiness: document.getElementById("otherbusiness").value.trim(),
      about: document.getElementById("about").value.trim(),
      services: getServicesFromForm(),
      googlepay: document.getElementById("googlepay").value.trim(),
      paytm: document.getElementById("paytm").value.trim(),
      paytm_QRcode: document.getElementById("paytm_QRcode").value.trim(),
      gallery_images: getGalleryFromForm(),
      videos: getVideosFromForm(),
      googlemap: document.getElementById("googlemap").value.trim(),
      website_url: document.getElementById("website_url").value.trim(),
      facebook: document.getElementById("facebook").value.trim(),
      twitter: document.getElementById("twitter").value.trim(),
      linkedin: document.getElementById("linkedin").value.trim(),
      youtube: (document.getElementById("youtube") && document.getElementById("youtube").value.trim()) || "",
      instagram: (document.getElementById("instagram") && document.getElementById("instagram").value.trim()) || "",
      custom_links: getCustomLinksFromForm(),
      profile_link: slug ? origin + "/" + slug : origin + "/your-name",
      card_slug: slug,
    };
  }

  function sanitizeAbout(text) {
    if (!text) return "";
    // Keep publish payload plain-text to reduce WAF false positives on HTML bodies.
    return String(text).replace(/<[^>]*>/g, "").trim();
  }

  function profileForExport() {
    var p = buildProfileFromForm();
    p.about = sanitizeAbout(p.about);
    return p;
  }

  function sendPreview() {
    if (!iframe || !iframe.contentWindow) return;
    var p = buildProfileFromForm();
    p.__preview = true;
    p.about = sanitizeAbout(p.about);
    iframe.contentWindow.postMessage({ type: "profile-update", profile: p }, "*");
  }

  function publishWithFallback(bodyObj) {
    return fetch("/save-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj),
    }).then(function (r) {
      if (r.status !== 403) return r;
      var params = new URLSearchParams();
      params.set("slug", bodyObj.slug || "");
      params.set("profile", JSON.stringify(bodyObj.profile || {}));
      params.set("razorpay_payment_id", bodyObj.razorpay_payment_id || "");
      params.set("razorpay_order_id", bodyObj.razorpay_order_id || "");
      params.set("razorpay_signature", bodyObj.razorpay_signature || "");
      return fetch("/complete", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: params.toString(),
      });
    });
  }

  var sendPreviewDebounced = debounce(sendPreview, 120);

  function addServiceRow(title, imgUrl, linkUrl, description) {
    var wrap = document.getElementById("services-rows");
    var row = document.createElement("div");
    row.className = "service-row border-bottom pb-3 mb-3";
    row.innerHTML =
      '<div class="row align-items-end">' +
      '<div class="col-md-5">' +
      '<label class="small text-muted mb-1">Title</label>' +
      '<input type="text" class="form-control svc-title" value="' +
      escapeAttr(title || "") +
      '">' +
      "</div>" +
      '<div class="col-md-6">' +
      '<label class="small text-muted mb-1">Image URL</label>' +
      '<input type="url" class="form-control svc-img" placeholder="https://..." value="' +
      escapeAttr(imgUrl || "") +
      '">' +
      "</div>" +
      '<div class="col-md-1">' +
      '<button type="button" class="btn btn-outline-danger btn-sm btn-remove mt-3" title="Remove">&times;</button>' +
      "</div>" +
      "</div>" +
      '<div class="row mt-1">' +
      '<div class="col-12">' +
      '<label class="small text-muted mb-1">Or upload image</label>' +
      '<input type="file" class="form-control-file form-control-sm svc-img-file" accept="image/*">' +
      "</div>" +
      "</div>" +
      '<div class="row mt-2">' +
      '<div class="col-md-6">' +
      '<label class="small text-muted mb-1">Button link <span class="font-weight-normal">(optional)</span></label>' +
      '<input type="url" class="form-control svc-link" placeholder="Opens in new tab; leave blank for Enquiry email" value="' +
      escapeAttr(linkUrl || "") +
      '">' +
      "</div>" +
      '<div class="col-md-6">' +
      '<label class="small text-muted mb-1">Description <span class="font-weight-normal">(optional)</span></label>' +
      '<textarea class="form-control svc-desc" rows="2" placeholder="Short text about this service">' +
      escapeAttr(description || "") +
      "</textarea>" +
      "</div>" +
      "</div>";
    wrap.appendChild(row);
    row.querySelector(".btn-remove").addEventListener("click", function () {
      row.remove();
      sendPreview();
    });
    row.querySelectorAll("input, textarea").forEach(function (inp) {
      if (inp.type === "file") return;
      inp.addEventListener("input", sendPreviewDebounced);
    });
    var imgFile = row.querySelector(".svc-img-file");
    if (imgFile) {
      imgFile.addEventListener("change", function (ev) {
        var f = ev.target.files && ev.target.files[0];
        if (!f) return;
        uploadToServer("/upload-image", "image", f)
          .then(function (data) {
            var inp = row.querySelector(".svc-img");
            if (inp) inp.value = getPublicOrigin() + data.url;
            sendPreview();
          })
          .catch(function () {
            window.alert("Image upload failed. Try a smaller file or paste a URL.");
          });
        imgFile.value = "";
      });
    }
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function setValue(id, value) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value = value == null ? "" : String(value);
  }

  function clearRows(selector) {
    var nodes = document.querySelectorAll(selector);
    nodes.forEach(function (n) {
      n.remove();
    });
  }

  function applyEditModeUi() {
    if (!isEditMode) return;
    var h1 = document.querySelector("h1.mb-3");
    if (h1) h1.textContent = "Edit card";
    var desc = document.querySelector("#btn-pay-publish").closest(".card-body").querySelector("p.small.text-muted.mb-2");
    if (desc) desc.textContent = "Update your existing card details. This saves changes immediately without a new payment.";
    var payBtn = document.getElementById("btn-pay-publish");
    if (payBtn) {
      payBtn.innerHTML = '<i class="fa fa-save mr-1"></i>Save changes';
      payBtn.classList.remove("btn-lg");
    }
    var price = document.getElementById("publish-price-label");
    if (price) price.textContent = "Editing mode";
    var warn = document.getElementById("publish-config-warn");
    if (warn) warn.hidden = true;
    var slugInput = document.getElementById("card_slug");
    if (slugInput) {
      slugInput.value = editSlug;
      slugInput.setAttribute("readonly", "readonly");
    }
  }

  function populateFormFromProfile(card) {
    if (!card || typeof card !== "object") return;
    setValue("theme_color", card.theme_color || "#1e90ff");
    updateThemeHexLabel();
    setValue("companyname", card.companyname);
    setValue("firstname", card.firstname);
    setValue("designation", card.designation);
    setValue("email", card.email);
    setValue("phonenumber", card.phonenumber);
    setValue("countrycode", card.countrycode || "+91");
    setValue("whatsupno", card.whatsupno);
    setValue("address", card.address);
    setValue("logo", card.logo);
    setValue("establishedyear", card.establishedyear);
    setValue("otherbusiness", card.otherbusiness);
    setValue("about", card.about);
    setValue("googlepay", card.googlepay);
    setValue("paytm", card.paytm);
    setValue("paytm_QRcode", card.paytm_QRcode);
    setValue("googlemap", card.googlemap);
    setValue("website_url", card.website_url);
    setValue("facebook", card.facebook);
    setValue("twitter", card.twitter);
    setValue("linkedin", card.linkedin);
    setValue("youtube", card.youtube);
    setValue("instagram", card.instagram);

    var gallery = Array.isArray(card.gallery_images) ? card.gallery_images : [];
    setValue("gallery_urls", gallery.map(function (g) { return (g && g.src) || ""; }).filter(Boolean).join("\n"));
    var videos = Array.isArray(card.videos) ? card.videos : [];
    setValue("video_urls", videos.map(function (v) { return (v && v.url) || ""; }).filter(Boolean).join("\n"));

    clearRows("#services-rows .service-row");
    (Array.isArray(card.services) ? card.services : []).forEach(function (svc) {
      addServiceRow((svc && svc.title) || "", (svc && svc.fileUrl) || "", (svc && svc.link) || "", (svc && svc.description) || "");
    });

    clearRows("#custom-social-rows .custom-link-row");
    (Array.isArray(card.custom_links) ? card.custom_links : []).forEach(function (link) {
      addCustomLinkRow((link && link.label) || "", (link && link.url) || "");
    });

    var slug = String(card.card_slug || editSlug || "").trim().toLowerCase();
    if (slug) {
      setValue("card_slug", slug);
      editSlug = slug;
    }
    updateCardUrlPreview();
  }

  function loadEditCard() {
    if (!isEditMode) return Promise.resolve();
    return fetch("/my-cards/" + encodeURIComponent(editSlug))
      .then(function (r) {
        return readJsonResponse(r).then(function (data) {
          if (!r.ok) throw new Error(data.error || "Could not load card for editing.");
          return data;
        });
      })
      .then(function (data) {
        populateFormFromProfile((data && data.card) || {});
        slugEditedByUser = true;
        sendPreview();
        checkSlugStatus();
      })
      .catch(function (e) {
        window.alert((e && e.message) || "Could not load card.");
        window.location.href = "/dashboard";
      });
  }

  function wireFormInputs() {
    var ids = [
      "theme_color",
      "companyname",
      "firstname",
      "designation",
      "email",
      "phonenumber",
      "countrycode",
      "whatsupno",
      "address",
      "logo",
      "establishedyear",
      "otherbusiness",
      "about",
      "googlepay",
      "paytm",
      "paytm_QRcode",
      "gallery_urls",
      "video_urls",
      "googlemap",
      "website_url",
      "facebook",
      "twitter",
      "linkedin",
      "youtube",
      "instagram",
      "card_slug",
    ];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener("input", sendPreviewDebounced);
        el.addEventListener("change", sendPreviewDebounced);
      }
    });
  }

  function loadPublishConfig() {
    fetch("/config")
      .then(function (r) {
        return readJsonResponse(r);
      })
      .then(function (c) {
        resolvedPublicBase = (c.publicBaseUrl || "").trim().replace(/\/+$/, "");
        updateCardUrlPreview();
        var priceEl = document.getElementById("publish-price-label");
        var warn = document.getElementById("publish-config-warn");
        var basePaise = Number(c.basePaise) || 300000;
        var gstPercent = Number(c.gstPercent);
        if (!Number.isFinite(gstPercent) || gstPercent < 0) gstPercent = 18;
        var totalPaise = Number(c.amountPaise) || Math.round(basePaise * (1 + gstPercent / 100));
        var baseRupees = (basePaise / 100).toFixed(2);
        var totalRupees = (totalPaise / 100).toFixed(2);
        if (priceEl) {
          priceEl.textContent =
            "Price: ₹" + baseRupees + " + " + gstPercent + "% GST = ₹" + totalRupees + " (plus gateway fee as shown in Razorpay)";
        }
        if (warn) warn.hidden = !!c.configured;
      })
      .catch(function () {
        var warn = document.getElementById("publish-config-warn");
        if (warn) warn.hidden = false;
      });
  }

  function renderMyCards(cards) {
    var listEl = document.getElementById("my-cards-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!Array.isArray(cards) || cards.length === 0) {
      listEl.innerHTML = '<li class="text-muted small">No cards published yet.</li>';
      return;
    }
    cards.slice().reverse().forEach(function (card) {
      var li = document.createElement("li");
      li.className = "mb-2";
      var slug = (card && card.slug) || "";
      var href = slug ? (getPublicOrigin() + "/" + slug) : "#";
      li.innerHTML =
        '<div class="d-flex flex-wrap align-items-center">' +
        '<a href="' +
        escapeAttr(href) +
        '" target="_blank" rel="noopener" class="mr-2">' +
        escapeAttr(slug || href) +
        "</a>" +
        '<a class="btn btn-outline-info btn-sm mr-2 py-0 px-2" href="/form?edit=' + encodeURIComponent(slug) + '">Edit</a>' +
        '<button type="button" class="btn btn-outline-danger btn-sm py-0 px-2 js-delete-card" data-slug="' + escapeAttr(slug) + '">Delete</button>' +
        "</div>";
      listEl.appendChild(li);
    });
  }

  function refreshMyCardsList() {
    return fetch("/my-cards")
      .then(function (r) {
        return readJsonResponse(r).then(function (data) {
          if (!r.ok) throw new Error(data.error || "Could not load saved cards.");
          renderMyCards(data.cards || []);
        });
      });
  }

  function wireSavedCardsActions() {
    var listEl = document.getElementById("my-cards-list");
    if (!listEl) return;
    listEl.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest(".js-delete-card");
      if (!btn) return;
      var slug = String(btn.getAttribute("data-slug") || "").trim().toLowerCase();
      if (!slug) return;
      if (!window.confirm('Delete card "' + slug + '"? This cannot be undone.')) return;
      btn.disabled = true;
      fetch("/my-cards/" + encodeURIComponent(slug), { method: "DELETE" })
        .then(function (r) {
          return readJsonResponse(r).then(function (data) {
            if (!r.ok) throw new Error(data.error || "Could not delete card.");
            return data;
          });
        })
        .then(function () {
          if (isEditMode && slug === editSlug) {
            window.location.href = "/form";
            return;
          }
          return refreshMyCardsList();
        })
        .catch(function (e) {
          window.alert((e && e.message) || "Could not delete card.");
        })
        .finally(function () {
          btn.disabled = false;
        });
    });
  }

  function loadAccountState() {
    return fetch("/auth/me")
      .then(function (r) {
        return readJsonResponse(r).then(function (data) {
          if (!r.ok) throw new Error(data.error || "Please log in again.");
          return data;
        });
      })
      .then(function (data) {
        var banner = document.getElementById("account-banner-text");
        if (banner && data && data.account) {
          banner.textContent = "Signed in as " + (data.account.name || data.account.email || "Account");
        }
        return refreshMyCardsList();
      })
      .catch(function () {
        window.location.href = "/login";
      });
  }

  document.getElementById("add-service").addEventListener("click", function () {
    addServiceRow("", "", "", "");
    sendPreview();
  });

  document.getElementById("add-custom-link").addEventListener("click", function () {
    addCustomLinkRow("", "");
    sendPreview();
  });

  function runGalleryUploads(files) {
    if (!files || !files.length) return;
    var hint = document.getElementById("gallery-upload-hint");
    var idx = 0;
    var origin = getPublicOrigin();
    function next() {
      if (idx >= files.length) {
        if (hint) hint.hidden = true;
        sendPreview();
        return;
      }
      if (hint) {
        hint.hidden = false;
        hint.textContent = "Uploading " + (idx + 1) + " / " + files.length + "…";
      }
      var f = files[idx];
      uploadToServer("/upload-image", "image", f)
        .then(function (data) {
          idx++;
          appendUrlToTextarea("gallery_urls", origin + data.url);
          next();
        })
        .catch(function () {
          idx++;
          if (hint) hint.textContent = "An upload failed. Try smaller images or URLs.";
          next();
        });
    }
    next();
  }

  function runVideoUploads(files) {
    if (!files || !files.length) return;
    var hint = document.getElementById("video-upload-hint");
    var idx = 0;
    var origin = getPublicOrigin();
    function next() {
      if (idx >= files.length) {
        if (hint) hint.hidden = true;
        sendPreview();
        return;
      }
      if (hint) {
        hint.hidden = false;
        hint.textContent = "Uploading " + (idx + 1) + " / " + files.length + "…";
      }
      var f = files[idx];
      uploadToServer("/upload-video", "video", f)
        .then(function (data) {
          idx++;
          appendUrlToTextarea("video_urls", origin + data.url);
          next();
        })
        .catch(function () {
          idx++;
          if (hint) hint.textContent = "An upload failed. Max ~100 MB per file, or use a URL.";
          next();
        });
    }
    next();
  }

  var galleryFiles = document.getElementById("gallery_files");
  if (galleryFiles) {
    galleryFiles.addEventListener("change", function (ev) {
      runGalleryUploads(ev.target.files);
      galleryFiles.value = "";
    });
  }

  var videoFiles = document.getElementById("video_files");
  if (videoFiles) {
    videoFiles.addEventListener("change", function (ev) {
      runVideoUploads(ev.target.files);
      videoFiles.value = "";
    });
  }

  document.getElementById("btn-pay-publish").addEventListener("click", function () {
    var slug = (document.getElementById("card_slug") && document.getElementById("card_slug").value.trim().toLowerCase()) || "";
    if (isEditMode) slug = editSlug;
    if (!isValidSlug(slug)) {
      window.alert(
        "Set a valid card URL: lowercase letters, numbers, single hyphens (not at start/end), max 32 characters."
      );
      return;
    }

    if (isEditMode) {
      var payload = profileForExport();
      payload.card_slug = slug;
      payload.profile_link = getPublicOrigin() + "/" + slug;
      fetch("/my-cards/" + encodeURIComponent(slug), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: payload }),
      })
        .then(function (r) {
          return readJsonResponse(r).then(function (data) {
            if (!r.ok) throw new Error(data.error || "Could not update card.");
            return data;
          });
        })
        .then(function () {
          window.alert("Card updated successfully.");
          sendPreview();
          refreshMyCardsList();
        })
        .catch(function (e) {
          window.alert((e && e.message) || "Could not update card.");
        });
      return;
    }

    if (!window.Razorpay) {
      window.alert("Razorpay checkout script did not load. Check your network.");
      return;
    }

    fetch("/slug-status?slug=" + encodeURIComponent(slug))
      .then(function (r) {
        return readJsonResponse(r);
      })
      .then(function (st) {
        if (!st.valid || !st.available) {
          window.alert(
            "This card URL is not available. Pick a suggested URL or change your name, then try again."
          );
          checkSlugStatus();
          return null;
        }
        return profileForExport();
      })
      .then(function (profile) {
        if (!profile) return;
        return fetch("/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }).then(function (r) {
          return readJsonResponse(r).then(function (j) {
            if (!r.ok) throw new Error(j.error || "Could not start payment");
            return j;
          });
        }).then(function (order) {
          return { profile: profile, order: order, slug: slug };
        });
      })
      .then(function (ctx) {
        if (!ctx) return;
        var profile = ctx.profile;
        var order = ctx.order;
        var slug = ctx.slug;
        var themeHex = (document.getElementById("theme_color") && document.getElementById("theme_color").value) || "#1e90ff";
        var opts = {
          key: order.keyId,
          amount: order.amount,
          currency: order.currency || "INR",
          order_id: order.orderId,
          name: (profile.companyname || "").trim() || "Digital vCard",
          description: "Publish your digital card",
          handler: function (response) {
            publishWithFallback({
                slug: slug,
                profile: profile,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
            })
              .then(function (r) {
                return readJsonResponse(r).then(function (j) {
                  if (r.status === 409) {
                    throw new Error((j.suggestions && j.suggestions.length ? "URL taken. Try: " + j.suggestions.join(", ") : null) || j.error || "URL taken");
                  }
                  if (!r.ok) throw new Error(j.error || "Publish failed");
                  return j;
                });
              })
              .then(function (data) {
                window.location.href = data.path || "/" + slug;
              })
              .catch(function (e) {
                window.alert(e.message || String(e));
              });
          },
          prefill: {
            email: (profile.email || "").trim(),
            contact: ((profile.countrycode || "") + (profile.phonenumber || "")).replace(/\D/g, ""),
          },
          // Keep UPI visible and prioritized in Checkout.
          method: {
            upi: true,
            card: true,
            netbanking: true,
            wallet: true,
            paylater: true,
            emi: true,
          },
          config: {
            display: {
              blocks: {
                upi: {
                  name: "Pay via UPI",
                  instruments: [{ method: "upi" }],
                },
              },
              sequence: ["block.upi", "block.card", "block.netbanking", "block.wallet"],
              preferences: {
                show_default_blocks: true,
              },
            },
          },
          theme: { color: themeHex },
        };
        var rzp = new window.Razorpay(opts);
        rzp.on("payment.failed", function () {
          window.alert("Payment failed. You were not charged, or the charge needs to be checked in Razorpay.");
        });
        rzp.open();
      })
      .catch(function (e) {
        if (e && e.message) window.alert(e.message);
      });
  });

  window.addEventListener("message", function (ev) {
    if (ev.data && ev.data.type === "card-ready") {
      sendPreview();
    }
  });

  document.getElementById("theme_color").addEventListener("input", function () {
    updateThemeHexLabel();
    sendPreviewDebounced();
  });

  document.getElementById("firstname").addEventListener("input", function () {
    if (!slugEditedByUser) {
      var gen = nameToSlug(document.getElementById("firstname").value);
      var inp = document.getElementById("card_slug");
      if (inp) inp.value = gen;
      updateCardUrlPreview();
      scheduleSlugStatusCheck();
    }
    sendPreviewDebounced();
  });

  document.getElementById("card_slug").addEventListener("input", function () {
    slugEditedByUser = true;
    updateCardUrlPreview();
    scheduleSlugStatusCheck();
    sendPreviewDebounced();
  });

  document.getElementById("logo_file").addEventListener("change", function (ev) {
    var file = ev.target.files && ev.target.files[0];
    var hint = document.getElementById("logo-upload-hint");
    var label = document.getElementById("logo_file_label");
    if (!file) {
      if (label) label.textContent = "Or upload from device…";
      return;
    }
    if (label) label.textContent = file.name;
    var fd = new FormData();
    fd.append("logo", file);
    if (hint) hint.hidden = false;
    fetch("/upload-logo", {
      method: "POST",
      body: fd,
    })
      .then(function (r) {
        return readJsonResponse(r).then(function (j) {
          if (!r.ok) throw new Error(j.error || "Upload failed");
          return j;
        });
      })
      .then(function (data) {
        var logoInp = document.getElementById("logo");
        if (logoInp) logoInp.value = getPublicOrigin() + data.url;
        if (hint) {
          hint.hidden = true;
          hint.textContent = "Uploading…";
        }
        sendPreview();
      })
      .catch(function () {
        if (hint) {
          hint.hidden = false;
          hint.textContent = "Upload failed. Try a smaller image or use a URL.";
        }
      });
  });

  iframe = document.getElementById("preview-frame");
  var logoutBtn = document.getElementById("btn-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      fetch("/auth/logout", { method: "POST" })
        .catch(function () {})
        .finally(function () {
          window.location.href = "/login";
        });
    });
  }
  applyEditModeUi();
  wireSavedCardsActions();
  wireFormInputs();
  updateThemeHexLabel();
  updateCardUrlPreview();
  document.getElementById("card-origin-prefix").textContent = getPublicOrigin() + "/";
  loadPublishConfig();
  loadAccountState();
  loadEditCard();

  iframe.addEventListener("load", function onLoad() {
    iframe.removeEventListener("load", onLoad);
    sendPreview();
    checkSlugStatus();
  });
})();
