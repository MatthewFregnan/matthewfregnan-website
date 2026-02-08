import json
import os
import re
import shutil
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from tkinterdnd2 import DND_FILES, TkinterDnD
from PIL import Image, ImageTk, ImageDraw, ImageFilter
from datetime import datetime

# =====================
# CONFIG
# =====================
PROJECTS_JSON = "data/projects.json"
IMAGES_DIR = "images"
THUMBNAILS_DIR = os.path.join(IMAGES_DIR, "thumbnails")
GALLERY_DIR = os.path.join(IMAGES_DIR, "gallery")

THUMBNAIL_SIZE = (260, 260)
GALLERY_SIZE = (150, 150)

FIELD_MAP = {
    "title": "Title",
    "client": "Client",
    "role": "Role",
    "year": "Year",
    "vimeoId": "Vimeo ID",
    "youtubeId": "Youtube ID",
    "description": "Description",
    "production": "Production",
}

# Color schemes
LIGHT_COLORS = {
    "bg": "#f8f9fa",
    "sidebar": "#2c3e50",
    "sidebar_text": "#ecf0f1",
    "primary": "#3498db",
    "primary_hover": "#2980b9",
    "danger": "#e74c3c",
    "danger_hover": "#c0392b",
    "success": "#27ae60",
    "success_hover": "#229954",
    "card": "#ffffff",
    "border": "#dfe6e9",
    "text": "#2c3e50",
    "text_light": "#7f8c8d",
    "selected": "#3498db",
    "selected_bg": "#ebf5fb",
    "topbar": "#ffffff",
    "topbar_border": "#dfe6e9",
}

DARK_COLORS = {
    "bg": "#1a1d23",
    "sidebar": "#0d0f12",
    "sidebar_text": "#e4e6eb",
    "primary": "#4a9eff",
    "primary_hover": "#3d8de5",
    "danger": "#ff4757",
    "danger_hover": "#ee3f4f",
    "success": "#2ecc71",
    "success_hover": "#27ae60",
    "card": "#242830",
    "border": "#3a3f4b",
    "text": "#e4e6eb",
    "text_light": "#8b92a3",
    "selected": "#4a9eff",
    "selected_bg": "#1e2a3a",
    "topbar": "#1e2126",
    "topbar_border": "#3a3f4b",
}

COLORS = LIGHT_COLORS.copy()

# =====================
# HELPERS
# =====================
def load_data():
    with open(PROJECTS_JSON, "r", encoding="utf-8") as f:
        return json.load(f)

def save_data(data):
    with open(PROJECTS_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def create_rounded_rectangle(canvas, x1, y1, x2, y2, radius=10, **kwargs):
    points = [
        x1+radius, y1,
        x1+radius, y1,
        x2-radius, y1,
        x2-radius, y1,
        x2, y1,
        x2, y1+radius,
        x2, y1+radius,
        x2, y2-radius,
        x2, y2-radius,
        x2, y2,
        x2-radius, y2,
        x2-radius, y2,
        x1+radius, y2,
        x1+radius, y2,
        x1, y2,
        x1, y2-radius,
        x1, y2-radius,
        x1, y1+radius,
        x1, y1+radius,
        x1, y1
    ]
    return canvas.create_polygon(points, **kwargs, smooth=True)

# =====================
# UNDO/REDO MANAGER
# =====================
class UndoManager:
    def __init__(self, max_history=50):
        self.history = []
        self.current = -1
        self.max_history = max_history
        
    def add_state(self, state):
        # Remove any states after current position
        self.history = self.history[:self.current + 1]
        # Add new state
        self.history.append(json.dumps(state))
        # Limit history size
        if len(self.history) > self.max_history:
            self.history.pop(0)
        else:
            self.current += 1
            
    def can_undo(self):
        return self.current > 0
        
    def can_redo(self):
        return self.current < len(self.history) - 1
        
    def undo(self):
        if self.can_undo():
            self.current -= 1
            return json.loads(self.history[self.current])
        return None
        
    def redo(self):
        if self.can_redo():
            self.current += 1
            return json.loads(self.history[self.current])
        return None

# =====================
# MODERN BUTTON
# =====================
class ModernButton(tk.Canvas):
    def __init__(self, parent, text="", command=None, bg_color=COLORS["primary"], 
                 fg_color="white", hover_color=None, **kwargs):
        super().__init__(parent, highlightthickness=0, **kwargs)
        self.text = text
        self.command = command
        self.bg_color = bg_color
        self.fg_color = fg_color
        self.hover_color = hover_color or bg_color
        self.is_hovered = False
        
        self.configure(bg=parent.cget("bg"))
        self.bind("<Configure>", self._draw)
        self.bind("<Button-1>", lambda e: self.command() if self.command else None)
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        
    def _draw(self, event=None):
        self.delete("all")
        w, h = self.winfo_width(), self.winfo_height()
        if w > 1 and h > 1:
            color = self.hover_color if self.is_hovered else self.bg_color
            create_rounded_rectangle(self, 2, 2, w-2, h-2, radius=6, 
                                    fill=color, outline="")
            self.create_text(w//2, h//2, text=self.text, fill=self.fg_color,
                           font=("SF Pro Text", 11, "bold"))
    
    def _on_enter(self, e):
        self.is_hovered = True
        self._draw()
        self.configure(cursor="hand2")
        
    def _on_leave(self, e):
        self.is_hovered = False
        self._draw()
        self.configure(cursor="")

# =====================
# MODERN ENTRY
# =====================
class ModernEntry(tk.Frame):
    def __init__(self, parent, label="", **kwargs):
        super().__init__(parent, bg=COLORS["bg"])
        self.label = label
        
        if label:
            # Create a container for inline layout
            container = tk.Frame(self, bg=COLORS["bg"])
            container.pack(fill="x")
            
            lbl = tk.Label(container, text=f"{label}:", bg=COLORS["bg"], fg=COLORS["text"],
                          font=("SF Pro Text", 11), anchor="e", width=12)
            lbl.pack(side="left", padx=(0, 10))
            
            self.entry = tk.Entry(container, relief="flat", bd=0, bg=COLORS["card"],
                                 fg=COLORS["text"], font=("SF Pro Text", 12),
                                 insertbackground=COLORS["primary"], **kwargs)
            self.entry.pack(side="left", fill="x", expand=True, ipady=8, ipadx=10)
        else:
            self.entry = tk.Entry(self, relief="flat", bd=0, bg=COLORS["card"],
                                 fg=COLORS["text"], font=("SF Pro Text", 12),
                                 insertbackground=COLORS["primary"], **kwargs)
            self.entry.pack(fill="x", ipady=8, ipadx=10)
        
        # Add subtle border
        self.entry.configure(highlightthickness=1, highlightbackground=COLORS["border"],
                           highlightcolor=COLORS["primary"])
    
    def get(self):
        return self.entry.get()
    
    def delete(self, first, last):
        self.entry.delete(first, last)
    
    def insert(self, index, string):
        self.entry.insert(index, string)

# =====================
# SCROLLABLE FRAME
# =====================
class ScrollableFrame(ttk.Frame):
    def __init__(self, container):
        super().__init__(container)
        self.canvas = tk.Canvas(self, highlightthickness=0, bg=COLORS["bg"])
        scrollbar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.scrollable_frame = ttk.Frame(self.canvas)
        self.scrollable_frame.configure(style="Card.TFrame")

        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )

        self.window_id = self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=scrollbar.set)

        self.canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self.canvas.bind("<Configure>", self._resize)

    def _resize(self, event):
        self.canvas.itemconfig(self.window_id, width=event.width)

# =====================
# APP
# =====================
class PortfolioApp(TkinterDnD.Tk):
    def __init__(self):
        super().__init__()
        self.title("Portfolio CMS Pro")
        self.geometry("1600x980")
        
        # Night mode - default to True
        self.night_mode = True
        
        # Apply dark colors by default
        global COLORS
        COLORS = DARK_COLORS.copy()

        # Setup styles
        self.setup_styles()
        
        self.configure(bg=COLORS["bg"])

        self.data = load_data()
        self.projects = self.data["projects"]
        self.categories = [c["id"] for c in self.data["categories"]]
        
        # Undo/Redo
        self.undo_manager = UndoManager()
        self.undo_manager.add_state(self.projects)

        self.selected_index = None
        self.selected_gallery_index = None
        self.search_var = tk.StringVar()
        self.search_var.trace("w", self.on_search)
        self.filter_category = tk.StringVar(value="All")

        self.thumbnail_image = None
        self.gallery_images = []
        
        # Unsaved changes tracking
        self.has_unsaved_changes = False

        self.build_ui()
        self.populate_tree()
        self.bind_shortcuts()

        if self.projects:
            self.select_project(0)

    def setup_styles(self):
        style = ttk.Style()
        style.theme_use('clam')
        
        # Configure treeview
        style.configure("Treeview",
            background=COLORS["sidebar"],
            foreground=COLORS["sidebar_text"],
            fieldbackground=COLORS["sidebar"],
            borderwidth=0,
            font=("SF Pro Text", 11))
        style.map("Treeview",
            background=[("selected", COLORS["selected"])],
            foreground=[("selected", "white")])
        
        # Configure frame
        style.configure("Card.TFrame", background=COLORS["bg"])
        
        # Configure scrollbars to match theme
        style.configure("Vertical.TScrollbar",
            background=COLORS["card"],
            troughcolor=COLORS["bg"],
            borderwidth=0,
            arrowcolor=COLORS["text"])
        style.map("Vertical.TScrollbar",
            background=[("active", COLORS["primary"]), ("!active", COLORS["border"])],
            arrowcolor=[("active", COLORS["primary"]), ("!active", COLORS["text_light"])])
        
        style.configure("Horizontal.TScrollbar",
            background=COLORS["card"],
            troughcolor=COLORS["bg"],
            borderwidth=0,
            arrowcolor=COLORS["text"])
        style.map("Horizontal.TScrollbar",
            background=[("active", COLORS["primary"]), ("!active", COLORS["border"])],
            arrowcolor=[("active", COLORS["primary"]), ("!active", COLORS["text_light"])])

    def toggle_night_mode(self):
        global COLORS
        self.night_mode = not self.night_mode
        
        # Switch color scheme
        COLORS = DARK_COLORS.copy() if self.night_mode else LIGHT_COLORS.copy()
        
        # Reapply theme
        self.apply_theme()
    
    def apply_theme(self):
        # Update styles
        self.setup_styles()
        
        # Rebuild UI to apply new colors
        for widget in self.winfo_children():
            widget.destroy()
        
        self.build_ui()
        self.populate_tree()
        
        if self.projects and self.selected_index is not None:
            self.select_project(self.selected_index)
        
        # Update night mode toggle button appearance
        if hasattr(self, 'night_mode_btn'):
            self.night_mode_btn.text = "☀️" if self.night_mode else "🌙"
            self.night_mode_btn._draw()

    def bind_shortcuts(self):
        # Use Control key bindings for cross-platform compatibility
        # Don't trigger if focus is on an Entry widget
        def safe_shortcut(func):
            def wrapper(event):
                # Don't trigger shortcuts when typing in entry fields
                if isinstance(event.widget, tk.Entry):
                    return
                func()
                return "break"  # Prevent further propagation
            return wrapper
        
        self.bind_all("<Command-n>", safe_shortcut(self.create_new_project))
        self.bind_all("<Command-d>", safe_shortcut(self.duplicate_project))
        self.bind_all("<Command-Up>", safe_shortcut(lambda: self.move_project(-1)))
        self.bind_all("<Command-Down>", safe_shortcut(lambda: self.move_project(1)))
        self.bind_all("<Command-s>", safe_shortcut(self.save_all))
        self.bind_all("<Command-z>", safe_shortcut(self.undo))
        self.bind_all("<Command-Shift-Z>", safe_shortcut(self.redo))
        self.bind_all("<Command-f>", safe_shortcut(lambda: self.search_entry.focus()))
        self.bind_all("<Command-Shift-L>", safe_shortcut(self.toggle_night_mode))

    def build_ui(self):
        # Main container
        main = tk.Frame(self, bg=COLORS["bg"])
        main.pack(fill="both", expand=True)

        # ==== LEFT SIDEBAR ====
        left = tk.Frame(main, bg=COLORS["sidebar"], width=310)
        left.pack(side="left", fill="y")
        left.pack_propagate(False)

        # Header
        header = tk.Frame(left, bg=COLORS["sidebar"], height=80)
        header.pack(fill="x")
        header.pack_propagate(False)
        
        tk.Label(header, text="Portfolio CMS", bg=COLORS["sidebar"],
                fg=COLORS["sidebar_text"], font=("SF Pro Display", 20, "bold")).pack(pady=(20, 5))
        
        stats = tk.Label(header, text=f"{len(self.projects)} Projects", 
                        bg=COLORS["sidebar"], fg=COLORS["text_light"],
                        font=("SF Pro Text", 11))
        stats.pack()
        self.stats_label = stats

        # Search bar
        search_frame = tk.Frame(left, bg=COLORS["sidebar"])
        search_frame.pack(fill="x", padx=15, pady=(10, 5))
        
        search_container = tk.Frame(search_frame, bg=COLORS["card"], highlightthickness=1,
                                   highlightbackground=COLORS["border"])
        search_container.pack(fill="x")
        
        tk.Label(search_container, text="🔍", bg=COLORS["card"], font=("SF Pro Text", 13)).pack(side="left", padx=(8, 0))
        self.search_entry = tk.Entry(search_container, textvariable=self.search_var,
                                     relief="flat", bd=0, bg=COLORS["card"], fg=COLORS["text"],
                                     font=("SF Pro Text", 11))
        self.search_entry.pack(side="left", fill="x", expand=True, ipady=6, padx=5)
        
        # Filter
        filter_frame = tk.Frame(left, bg=COLORS["sidebar"])
        filter_frame.pack(fill="x", padx=15, pady=(5, 10))
        
        tk.Label(filter_frame, text="Filter:", bg=COLORS["sidebar"],
                fg=COLORS["text_light"], font=("SF Pro Text", 10)).pack(side="left", padx=(0, 5))
        
        filter_combo = ttk.Combobox(filter_frame, textvariable=self.filter_category,
                                   values=["All"] + self.categories, state="readonly",
                                   font=("SF Pro Text", 10), width=15)
        filter_combo.pack(side="left")
        filter_combo.bind("<<ComboboxSelected>>", lambda e: self.on_search())

        # Tree
        tree_frame = tk.Frame(left, bg=COLORS["sidebar"])
        tree_frame.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        
        self.tree = ttk.Treeview(tree_frame, show="tree")
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", self.on_select)
        
        # Tree scrolling - only when mouse is over it
        self.tree.bind("<Enter>", self._bind_tree_scroll)
        self.tree.bind("<Leave>", self._unbind_tree_scroll)

        # Action buttons
        btn_frame = tk.Frame(left, bg=COLORS["sidebar"])
        btn_frame.pack(fill="x", padx=15, pady=15)
        
        ModernButton(btn_frame, text="✨ New Project", command=self.create_new_project,
                    bg_color=COLORS["success"], hover_color=COLORS["success_hover"],
                    height=40).pack(fill="x", pady=3)
        
        ModernButton(btn_frame, text="📋 Duplicate", command=self.duplicate_project,
                    bg_color=COLORS["primary"], hover_color=COLORS["primary_hover"],
                    height=36).pack(fill="x", pady=3)
        
        ModernButton(btn_frame, text="🗑 Delete", command=self.delete_project,
                    bg_color=COLORS["danger"], hover_color=COLORS["danger_hover"],
                    height=36).pack(fill="x", pady=3)

        # ==== RIGHT PANEL ====
        right = tk.Frame(main, bg=COLORS["bg"])
        right.pack(side="right", fill="both", expand=True)

        # Top bar
        topbar = tk.Frame(right, bg=COLORS["topbar"], height=70, highlightthickness=1,
                         highlightbackground=COLORS["topbar_border"])
        topbar.pack(fill="x")
        topbar.pack_propagate(False)
        
        topbar_content = tk.Frame(topbar, bg=COLORS["topbar"])
        topbar_content.pack(fill="both", expand=True, padx=30, pady=15)
        
        self.project_title_label = tk.Label(topbar_content, text="Select a project",
                                            bg=COLORS["topbar"], fg=COLORS["text"],
                                            font=("SF Pro Display", 18, "bold"),
                                            anchor="w")
        self.project_title_label.pack(side="left", fill="x", expand=True)
        
        # Night mode toggle
        self.night_mode_btn = ModernButton(topbar_content, text="☀️",
                                          command=self.toggle_night_mode,
                                          bg_color=COLORS["text_light"],
                                          width=50, height=40)
        self.night_mode_btn.pack(side="right", padx=(10, 0))
        
        # Undo/Redo buttons
        undo_frame = tk.Frame(topbar_content, bg=COLORS["topbar"])
        undo_frame.pack(side="right")
        
        self.undo_btn = ModernButton(undo_frame, text="↶ Undo", command=self.undo,
                                     bg_color=COLORS["text_light"], width=80, height=35)
        self.undo_btn.pack(side="left", padx=3)
        
        self.redo_btn = ModernButton(undo_frame, text="↷ Redo", command=self.redo,
                                     bg_color=COLORS["text_light"], width=80, height=35)
        self.redo_btn.pack(side="left", padx=3)
        
        ModernButton(topbar_content, text="💾 Save All", command=self.save_all,
                    bg_color=COLORS["success"], hover_color=COLORS["success_hover"],
                    width=110, height=40).pack(side="right", padx=(10, 0))

        # Content area
        content = tk.Frame(right, bg=COLORS["bg"])
        content.pack(fill="both", expand=True, padx=30, pady=20)

        scroll = ScrollableFrame(content)
        scroll.pack(fill="both", expand=True)
        form = scroll.scrollable_frame

        # Create two-column layout: left for fields, right for thumbnail
        columns_container = tk.Frame(form, bg=COLORS["bg"])
        columns_container.pack(fill="both", expand=True)
        
        # Left column - text fields
        left_column = tk.Frame(columns_container, bg=COLORS["bg"])
        left_column.pack(side="left", fill="both", expand=True, padx=(0, 15))
        
        # Right column - thumbnail (fixed height)
        right_column = tk.Frame(columns_container, bg=COLORS["bg"])
        right_column.pack(side="left", fill="y", padx=(15, 0))

        # Form fields in left column
        self.fields = {}
        for key, label in FIELD_MAP.items():
            entry = ModernEntry(left_column, label=label)
            entry.pack(fill="x", pady=6)
            self.fields[key] = entry

        # Category in left column
        cat_frame = tk.Frame(left_column, bg=COLORS["bg"])
        cat_frame.pack(fill="x", pady=6)
        
        tk.Label(cat_frame, text="Category:", bg=COLORS["bg"], fg=COLORS["text"],
                font=("SF Pro Text", 11), anchor="e", width=12).pack(side="left", padx=(0, 10))
        
        self.category_var = tk.StringVar()
        cat_combo = ttk.Combobox(cat_frame, values=self.categories,
                                textvariable=self.category_var, state="readonly",
                                font=("SF Pro Text", 12))
        cat_combo.pack(side="left", fill="x", expand=True)
        cat_combo.bind("<<ComboboxSelected>>", self.on_category_change)

        # Thumbnail section in right column with fixed height
        thumb_section = tk.Frame(right_column, bg=COLORS["card"], highlightthickness=1,
                                highlightbackground=COLORS["border"], width=500, height=450)
        thumb_section.pack(fill="x")
        thumb_section.pack_propagate(False)
        
        tk.Label(thumb_section, text="📷 Thumbnail", bg=COLORS["card"],
                fg=COLORS["text"], font=("SF Pro Text", 13, "bold"),
                anchor="w").pack(fill="x", pady=(15, 10), padx=15)
        
        # Thumbnail display area with fixed height
        thumb_display_frame = tk.Frame(thumb_section, bg=COLORS["bg"], height=280)
        thumb_display_frame.pack(fill="x", pady=10, padx=15)
        thumb_display_frame.pack_propagate(False)
        
        self.thumbnail_label = tk.Label(thumb_display_frame, bg=COLORS["bg"],
                                       text="No thumbnail", fg=COLORS["text_light"])
        self.thumbnail_label.pack(expand=True)
        
        # Buttons at bottom with padding
        thumb_btn_frame = tk.Frame(thumb_section, bg=COLORS["card"])
        thumb_btn_frame.pack(side="bottom", padx=15, pady=15)
        
        ModernButton(thumb_btn_frame, text="📁 Choose",
                    command=self.pick_thumbnail, width=120, height=36).pack(pady=3, fill="x")
        
        ModernButton(thumb_btn_frame, text="🗑 Remove",
                    command=self.remove_thumbnail,
                    bg_color=COLORS["danger"], hover_color=COLORS["danger_hover"],
                    width=120, height=36).pack(pady=3, fill="x")
        
        # Drag and drop
        self.thumbnail_label.drop_target_register(DND_FILES)
        self.thumbnail_label.dnd_bind('<<Drop>>', self.on_thumbnail_drop)

        # Gallery section (only shown for colour-grading projects)
        self.gallery_section = tk.Frame(form, bg=COLORS["card"], highlightthickness=1,
                                  highlightbackground=COLORS["border"])
        gallery_section = self.gallery_section
        
        tk.Label(gallery_section, text="🖼 Gallery", bg=COLORS["card"],
                fg=COLORS["text"], font=("SF Pro Text", 13, "bold"),
                anchor="w").pack(fill="x", pady=(0, 10))
        
        # Gallery canvas with horizontal scrollbar
        gallery_container = tk.Frame(gallery_section, bg=COLORS["card"])
        gallery_container.pack(fill="x", pady=10)
        
        self.gallery_canvas = tk.Canvas(gallery_container, height=170, bg=COLORS["bg"],
                                       highlightthickness=0)
        gallery_scrollbar = tk.Scrollbar(gallery_container, orient="horizontal", 
                                        command=self.gallery_canvas.xview)
        self.gallery_canvas.configure(xscrollcommand=gallery_scrollbar.set)
        
        self.gallery_frame = tk.Frame(self.gallery_canvas, bg=COLORS["bg"])
        self.gallery_window = self.gallery_canvas.create_window((0, 0),
                                                                window=self.gallery_frame,
                                                                anchor="nw")
        
        self.gallery_canvas.pack(fill="x")
        gallery_scrollbar.pack(fill="x", pady=(5, 0))
        
        self.gallery_frame.bind("<Configure>",
            lambda e: self.gallery_canvas.configure(scrollregion=self.gallery_canvas.bbox("all")))

        # Gallery controls
        gallery_ctrl = tk.Frame(gallery_section, bg=COLORS["card"])
        gallery_ctrl.pack(fill="x", pady=(10, 0))
        
        self.gallery_controls = gallery_ctrl
        
        ModernButton(gallery_ctrl, text="+ Add Images", command=self.pick_gallery,
                    bg_color=COLORS["primary"], hover_color=COLORS["primary_hover"],
                    width=140, height=38).pack(side="left", padx=3)
        
        self.move_left_btn = ModernButton(gallery_ctrl, text="◀", command=lambda: self.move_gallery(-1),
                                         bg_color=COLORS["text_light"], width=50, height=38)
        self.move_left_btn.pack(side="left", padx=3)
        
        self.move_right_btn = ModernButton(gallery_ctrl, text="▶", command=lambda: self.move_gallery(1),
                                          bg_color=COLORS["text_light"], width=50, height=38)
        self.move_right_btn.pack(side="left", padx=3)
        
        self.delete_gallery_btn = ModernButton(gallery_ctrl, text="🗑 Remove",
                                              command=self.remove_selected_gallery,
                                              bg_color=COLORS["danger"],
                                              hover_color=COLORS["danger_hover"],
                                              width=100, height=38)
        self.delete_gallery_btn.pack(side="left", padx=3)
        
        # Drag and drop for gallery
        self.gallery_canvas.drop_target_register(DND_FILES)
        self.gallery_canvas.dnd_bind('<<Drop>>', self.on_gallery_drop)

        # Bottom save button
        ModernButton(content, text="💾 Save Project Changes",
                    command=self.save_project,
                    bg_color=COLORS["success"], hover_color=COLORS["success_hover"],
                    height=45).pack(fill="x", pady=(20, 0))

    # ========== UNDO/REDO ==========
    def undo(self):
        state = self.undo_manager.undo()
        if state:
            self.projects = state
            self.data["projects"] = self.projects
            self.populate_tree()
            if self.selected_index is not None and self.selected_index < len(self.projects):
                self.load_project()
            self.update_undo_buttons()
    
    def _bind_tree_scroll(self, event):
        """Bind mousewheel to tree when mouse enters"""
        self.tree.bind_all("<MouseWheel>", self._on_tree_scroll)
        self.tree.bind_all("<Button-4>", self._on_tree_scroll)
        self.tree.bind_all("<Button-5>", self._on_tree_scroll)
    
    def _unbind_tree_scroll(self, event):
        """Unbind mousewheel from tree when mouse leaves"""
        self.tree.unbind_all("<MouseWheel>")
        self.tree.unbind_all("<Button-4>")
        self.tree.unbind_all("<Button-5>")
    
    def _on_tree_scroll(self, event):
        """Handle tree scrolling"""
        if event.num == 5 or event.delta < 0:
            self.tree.yview_scroll(1, "units")
        elif event.num == 4 or event.delta > 0:
            self.tree.yview_scroll(-1, "units")

    def redo(self):
        state = self.undo_manager.redo()
        if state:
            self.projects = state
            self.data["projects"] = self.projects
            self.populate_tree()
            if self.selected_index is not None and self.selected_index < len(self.projects):
                self.load_project()
            self.update_undo_buttons()
    
    def update_undo_buttons(self):
        # Visual feedback for undo/redo availability
        pass  # Could gray out buttons when unavailable
    
    def save_state(self):
        self.undo_manager.add_state([dict(p) for p in self.projects])
        self.has_unsaved_changes = True

    # ========== SEARCH/FILTER ==========
    def on_category_change(self, event=None):
        """Handle category change to show/hide gallery section"""
        if self.selected_index is None:
            return
        
        selected_category = self.category_var.get()
        if selected_category == "colour-grading":
            self.gallery_section.pack(fill="x", pady=20, ipady=20, ipadx=20)
        else:
            self.gallery_section.pack_forget()
    
    def on_search(self, *args):
        search_term = self.search_var.get().lower()
        filter_cat = self.filter_category.get()
        
        self.tree.delete(*self.tree.get_children())
        self.cat_nodes = {}
        
        for c in self.categories:
            if filter_cat == "All" or filter_cat == c:
                self.cat_nodes[c] = self.tree.insert("", "end", text=c.upper(), open=True)
        
        for i, p in enumerate(self.projects):
            # Filter by category
            if filter_cat != "All" and p["category"] != filter_cat:
                continue
            
            # Filter by search
            if search_term:
                searchable = f"{p.get('title', '')} {p.get('client', '')} {p.get('role', '')}".lower()
                if search_term not in searchable:
                    continue
            
            if p["category"] in self.cat_nodes:
                self.tree.insert(self.cat_nodes[p["category"]], "end",
                               text=p["title"], values=(i,))

    # ========== DRAG AND DROP ==========
    def on_thumbnail_drop(self, event):
        files = self.parse_drop_files(event.data)
        if files and self.selected_index is not None:
            self.process_thumbnail(files[0])
    
    def on_gallery_drop(self, event):
        files = self.parse_drop_files(event.data)
        if files and self.selected_index is not None:
            self.process_gallery_files(files)
    
    def parse_drop_files(self, data):
        # Parse the file paths from drag and drop
        files = []
        for item in data.split():
            item = item.strip('{}')
            if os.path.isfile(item):
                files.append(item)
        return files

    # ========== PROJECT MANAGEMENT ==========
    def select_project(self, index):
        if index < 0 or index >= len(self.projects):
            return
            
        self.selected_index = index
        cat = self.projects[index]["category"]
        
        # Find and select in tree
        found = False
        for cat_node in self.tree.get_children():
            for child in self.tree.get_children(cat_node):
                try:
                    if int(self.tree.item(child, "values")[0]) == index:
                        self.tree.selection_set(child)
                        self.tree.see(child)
                        found = True
                        break
                except (ValueError, IndexError):
                    continue
            if found:
                break
        
        # Always load the project, even if tree selection didn't work
        self.load_project()

    def populate_tree(self):
        self.tree.delete(*self.tree.get_children())
        self.cat_nodes = {}
        
        for c in self.categories:
            self.cat_nodes[c] = self.tree.insert("", "end", text=c.upper(), open=True)
        
        for i, p in enumerate(self.projects):
            self.tree.insert(self.cat_nodes[p["category"]], "end",
                           text=p["title"], values=(i,))
        
        self.stats_label.config(text=f"{len(self.projects)} Projects")

    def on_select(self, _):
        selection = self.tree.selection()
        if not selection:
            return
        
        item = selection[0]
        values = self.tree.item(item, "values")
        
        if values:  # It's a project, not a category
            self.selected_index = int(values[0])
            self.load_project()

    def load_project(self):
        if self.selected_index is None or self.selected_index >= len(self.projects):
            return
            
        p = self.projects[self.selected_index]
        
        # Update title
        self.project_title_label.config(text=p.get("title", "Untitled Project"))
        
        # Load fields
        for k, widget in self.fields.items():
            widget.delete(0, tk.END)
            widget.insert(0, p.get(k, ""))
        
        self.category_var.set(p.get("category", ""))
        self.load_thumbnail(p)
        
        # Show/hide gallery based on category
        if p.get("category") == "colour-grading":
            self.gallery_section.pack(fill="x", pady=20, ipady=20, ipadx=20)
            self.load_gallery(p)
        else:
            self.gallery_section.pack_forget()

    def load_thumbnail(self, project):
        if "thumbnail" in project and project["thumbnail"]:
            try:
                img_path = os.path.join(THUMBNAILS_DIR, project["thumbnail"])
                img = Image.open(img_path)
                
                # Check if image is wide (landscape orientation)
                # If width is significantly larger than height, scale to fit container width
                is_wide = img.width > img.height * 1.3  # More than 30% wider than tall
                
                if is_wide:
                    # For wide images, scale to fit the larger container width (~470px available)
                    # Use 450px to leave some margin
                    aspect_ratio = img.height / img.width
                    new_width = 450
                    new_height = int(new_width * aspect_ratio)
                    img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                else:
                    # For portrait/square images, use standard thumbnail sizing
                    img.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
                
                # Add subtle shadow effect
                shadow = Image.new('RGBA', (img.width + 10, img.height + 10), (0, 0, 0, 0))
                shadow_draw = ImageDraw.Draw(shadow)
                shadow_draw.rectangle([5, 5, img.width + 5, img.height + 5],
                                     fill=(0, 0, 0, 30))
                shadow = shadow.filter(ImageFilter.GaussianBlur(5))
                shadow.paste(img, (5, 5), img if img.mode == 'RGBA' else None)
                
                self.thumbnail_image = ImageTk.PhotoImage(shadow)
                self.thumbnail_label.config(image=self.thumbnail_image, text="",
                                          bg=COLORS["card"])
            except Exception as e:
                print(f"Error loading thumbnail: {e}")
                self.thumbnail_label.config(image="", text="Error loading image",
                                          bg=COLORS["card"])
        else:
            self.thumbnail_label.config(image="", text="No thumbnail",
                                      bg=COLORS["bg"])

    def load_gallery(self, project):
        # Clear existing
        for w in self.gallery_frame.winfo_children():
            w.destroy()
        self.gallery_images.clear()
        self.selected_gallery_index = None

        gallery = project.get("gallery", [])
        
        for i, rel in enumerate(gallery):
            try:
                img_path = os.path.join(GALLERY_DIR, rel)
                img = Image.open(img_path)
                img.thumbnail(GALLERY_SIZE, Image.Resampling.LANCZOS)
                
                tk_img = ImageTk.PhotoImage(img)
                self.gallery_images.append(tk_img)

                # Card for each image
                card = tk.Frame(self.gallery_frame, bg=COLORS["card"], highlightthickness=2,
                               highlightbackground=COLORS["border"], cursor="hand2")
                card.pack(side="left", padx=6, pady=6)
                
                lbl = tk.Label(card, image=tk_img, bg=COLORS["card"])
                lbl.pack(padx=4, pady=4)
                
                # Bind click
                lbl.bind("<Button-1>", lambda e, idx=i: self.select_gallery(idx))
                card.bind("<Button-1>", lambda e, idx=i: self.select_gallery(idx))
                
            except Exception as e:
                print(f"Error loading gallery image: {e}")

        self.gallery_canvas.update_idletasks()
        self.gallery_canvas.configure(scrollregion=self.gallery_canvas.bbox("all"))

    def select_gallery(self, index):
        self.selected_gallery_index = index
        
        for i, card in enumerate(self.gallery_frame.winfo_children()):
            if i == index:
                card.config(highlightbackground=COLORS["selected"],
                          highlightthickness=3)
            else:
                card.config(highlightbackground=COLORS["border"],
                          highlightthickness=2)

    def move_gallery(self, direction):
        if self.selected_gallery_index is None:
            return
        
        g = self.projects[self.selected_index]["gallery"]
        i = self.selected_gallery_index
        j = i + direction
        
        if 0 <= j < len(g):
            g[i], g[j] = g[j], g[i]
            self.save_state()
            self.load_gallery(self.projects[self.selected_index])
            self.select_gallery(j)

    def remove_selected_gallery(self):
        if self.selected_gallery_index is None:
            messagebox.showwarning("No Selection", "Please select an image to remove")
            return
        
        self.projects[self.selected_index]["gallery"].pop(self.selected_gallery_index)
        self.save_state()
        self.load_gallery(self.projects[self.selected_index])

    # ========== FILE OPERATIONS ==========
    def pick_thumbnail(self):
        file = filedialog.askopenfilename(
            title="Select Thumbnail",
            filetypes=[("Image Files", "*.png *.jpg *.jpeg *.gif *.bmp *.webp")]
        )
        if file:
            self.process_thumbnail(file)

    def process_thumbnail(self, file):
        if not self.selected_index is not None:
            return
            
        p = self.projects[self.selected_index]
        category_folder = os.path.join(THUMBNAILS_DIR, p["category"])
        os.makedirs(category_folder, exist_ok=True)

        ext = os.path.splitext(file)[1]
        dest_name = f"{p['id']}{ext}"
        dest = os.path.join(category_folder, dest_name)

        shutil.copy(file, dest)
        p["thumbnail"] = os.path.join(p["category"], dest_name)
        self.save_state()
        self.load_thumbnail(p)

    def remove_thumbnail(self):
        if self.selected_index is None:
            return
        
        p = self.projects[self.selected_index]
        if "thumbnail" in p:
            p["thumbnail"] = ""
            self.save_state()
            self.load_thumbnail(p)

    def pick_gallery(self):
        files = filedialog.askopenfilenames(
            title="Select Gallery Images",
            filetypes=[("Image Files", "*.png *.jpg *.jpeg *.gif *.bmp *.webp")]
        )
        if files:
            self.process_gallery_files(files)

    def process_gallery_files(self, files):
        if self.selected_index is None:
            return
            
        p = self.projects[self.selected_index]
        if "gallery" not in p:
            p["gallery"] = []

        project_folder = os.path.join(GALLERY_DIR, p["id"])
        os.makedirs(project_folder, exist_ok=True)

        existing = len(p["gallery"])
        for i, f in enumerate(files, start=1):
            ext = os.path.splitext(f)[1]
            dest_name = f"{p['id']}-{existing+i}{ext}"
            dest = os.path.join(project_folder, dest_name)
            shutil.copy(f, dest)
            p["gallery"].append(os.path.join(p["id"], dest_name))

        self.save_state()
        self.load_gallery(p)

    # ========== ACTIONS ==========
    def save_project(self):
        if self.selected_index is None:
            return
            
        p = self.projects[self.selected_index]
        
        for k, widget in self.fields.items():
            v = widget.get().strip()
            p[k] = v
        
        p["category"] = self.category_var.get()
        p["updated"] = datetime.now().isoformat()
        
        self.save_state()
        self.populate_tree()
        self.select_project(self.selected_index)
        
        messagebox.showinfo("Success", "Project changes saved!")

    def save_all(self):
        save_data(self.data)
        self.has_unsaved_changes = False
        messagebox.showinfo("Saved", f"All {len(self.projects)} projects saved successfully!")

    def create_new_project(self):
        popup = tk.Toplevel(self)
        popup.title("Create New Project")
        popup.geometry("450x280")
        popup.configure(bg=COLORS["bg"])
        popup.transient(self)
        popup.grab_set()

        content = tk.Frame(popup, bg=COLORS["bg"])
        content.pack(fill="both", expand=True, padx=30, pady=30)

        tk.Label(content, text="Create New Project", bg=COLORS["bg"],
                fg=COLORS["text"], font=("SF Pro Display", 18, "bold")).pack(anchor="w", pady=(0, 20))

        title_entry = ModernEntry(content, label="Project Title")
        title_entry.pack(fill="x", pady=8)

        # Category with inline label
        cat_frame = tk.Frame(content, bg=COLORS["bg"])
        cat_frame.pack(fill="x", pady=8)
        
        tk.Label(cat_frame, text="Category:", bg=COLORS["bg"],
                fg=COLORS["text"], font=("SF Pro Text", 11), anchor="e", width=12).pack(side="left", padx=(0, 10))
        
        category_var = tk.StringVar(value=self.categories[0])
        cat_combo = ttk.Combobox(cat_frame, values=self.categories,
                                textvariable=category_var, state="readonly",
                                font=("SF Pro Text", 12))
        cat_combo.pack(side="left", fill="x", expand=True)

        def create():
            title = title_entry.get().strip()
            category = category_var.get()
            
            if not title:
                messagebox.showwarning("Error", "Project title cannot be empty")
                return
            
            # Generate ID
            base = re.sub(r'[^a-z0-9\-]', '', title.lower().replace(" ", "-"))
            proj_id = base
            counter = 1
            while any(p["id"] == proj_id for p in self.projects):
                proj_id = f"{base}-{counter}"
                counter += 1
            
            new_project = {
                "id": proj_id,
                "title": title,
                "category": category,
                "gallery": [],
                "created": datetime.now().isoformat()
            }
            
            self.projects.append(new_project)
            self.save_state()
            
            # Clear search/filter to ensure new project is visible
            self.search_var.set("")
            self.filter_category.set("All")
            
            self.populate_tree()
            self.select_project(len(self.projects) - 1)
            popup.destroy()

        btn_frame = tk.Frame(content, bg=COLORS["bg"])
        btn_frame.pack(fill="x", pady=(20, 0))
        
        ModernButton(btn_frame, text="Create Project", command=create,
                    bg_color=COLORS["success"], hover_color=COLORS["success_hover"],
                    height=45).pack(fill="x")
        
        title_entry.entry.focus()
        popup.bind("<Return>", lambda e: create())

    def duplicate_project(self):
        if self.selected_index is None:
            messagebox.showwarning("No Selection", "Please select a project to duplicate")
            return
        
        orig = self.projects[self.selected_index]
        new_proj = dict(orig)
        
        # Generate unique ID
        base = orig["id"]
        proj_id = f"{base}-copy"
        counter = 1
        while any(p["id"] == proj_id for p in self.projects):
            proj_id = f"{base}-copy-{counter}"
            counter += 1
        
        new_proj["id"] = proj_id
        new_proj["title"] = f"{orig.get('title', 'Untitled')} (Copy)"
        new_proj["created"] = datetime.now().isoformat()
        
        self.projects.insert(self.selected_index + 1, new_proj)
        self.save_state()
        
        # Clear search/filter to ensure duplicated project is visible
        self.search_var.set("")
        self.filter_category.set("All")
        
        self.populate_tree()
        self.select_project(self.selected_index + 1)

    def move_project(self, direction):
        if self.selected_index is None:
            return
        
        current_project = self.projects[self.selected_index]
        current_category = current_project["category"]
        
        # Find all projects in the same category
        category_projects = []
        for i, p in enumerate(self.projects):
            if p["category"] == current_category:
                category_projects.append((i, p))
        
        # Find current position within category
        category_position = None
        for pos, (idx, proj) in enumerate(category_projects):
            if idx == self.selected_index:
                category_position = pos
                break
        
        if category_position is None:
            return
        
        # Calculate new position within category
        new_category_position = category_position + direction
        
        # Check bounds within category
        if new_category_position < 0 or new_category_position >= len(category_projects):
            return
        
        # Get the array indices to swap
        idx1 = category_projects[category_position][0]
        idx2 = category_projects[new_category_position][0]
        
        # Swap in the array
        self.projects[idx1], self.projects[idx2] = self.projects[idx2], self.projects[idx1]
        
        self.save_state()
        self.populate_tree()
        
        # Update selected_index to the new position
        self.selected_index = idx2
        self.select_project(self.selected_index)

    def delete_project(self):
        if self.selected_index is None:
            messagebox.showwarning("No Selection", "Please select a project to delete")
            return

        p = self.projects[self.selected_index]
        
        result = messagebox.askyesno("Delete Project",
            f"Are you sure you want to delete '{p.get('title', 'this project')}'?\n\nThis will also delete all associated images.")
        
        if not result:
            return

        # Delete thumbnail
        if "thumbnail" in p and p["thumbnail"]:
            thumb_path = os.path.join(THUMBNAILS_DIR, p["thumbnail"])
            if os.path.exists(thumb_path):
                try:
                    os.remove(thumb_path)
                except Exception as e:
                    print(f"Error deleting thumbnail: {e}")

        # Delete gallery images
        if "gallery" in p:
            for img_rel in p["gallery"]:
                img_path = os.path.join(GALLERY_DIR, img_rel)
                if os.path.exists(img_path):
                    try:
                        os.remove(img_path)
                    except Exception as e:
                        print(f"Error deleting gallery image: {e}")

            # Remove project folder if empty
            project_folder = os.path.join(GALLERY_DIR, p["id"])
            if os.path.exists(project_folder) and not os.listdir(project_folder):
                try:
                    os.rmdir(project_folder)
                except Exception as e:
                    print(f"Error deleting project folder: {e}")

        # Remove from list
        self.projects.pop(self.selected_index)
        self.save_state()
        self.selected_index = None
        self.populate_tree()
        
        # Clear form
        self.project_title_label.config(text="Select a project")
        for widget in self.fields.values():
            widget.delete(0, tk.END)

# =====================
# RUN
# =====================
if __name__ == "__main__":
    try:
        app = PortfolioApp()
        app.mainloop()
    except Exception as e:
        print(f"Error: {e}")
        print("Note: This enhanced version requires tkinterdnd2 for drag-and-drop.")
        print("Install it with: pip install tkinterdnd2")