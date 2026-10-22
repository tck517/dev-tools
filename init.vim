" ==============================================================================
" NEOVIM CONFIGURATION
" ==============================================================================

set nocompatible

" ==============================================================================
" PLUGIN DECLARATIONS
" ==============================================================================

call plug#begin("~/.config/nvim/bundle")

" Git Integration
Plug 'tpope/vim-fugitive'
Plug 'airblade/vim-gitgutter'
Plug 'esmuellert/codediff.nvim'

" Lua utilities
Plug 'nvim-lua/plenary.nvim'

" File Explorer
Plug 'nvim-tree/nvim-web-devicons'
Plug 'nvim-tree/nvim-tree.lua'

" Fuzzy Finder
Plug 'junegunn/fzf', { 'dir': '~/.fzf', 'do': './install --all' }
Plug 'junegunn/fzf.vim'

" Language Support
Plug 'hashivim/vim-terraform'
Plug 'ellisonleao/glow.nvim'

" Editing Enhancements
Plug 'tpope/vim-surround'
Plug 'cohama/lexima.vim'
Plug 'honza/vim-snippets'
Plug 'junegunn/vim-peekaboo'

" Writing Tools
Plug 'junegunn/goyo.vim'
Plug 'reedes/vim-pencil'
Plug 'junegunn/limelight.vim'

" Testing
Plug 'vim-test/vim-test'

" Navigation
Plug 'christoomey/vim-tmux-navigator'
Plug 'MattesGroeger/vim-bookmarks'

" UI/Themes
Plug 'vim-airline/vim-airline'
Plug 'morhetz/gruvbox'

" Miscellaneous
Plug 'vim-scripts/dbext.vim'
Plug 'wolandark/vim-loremipsum'

call plug#end()

" ==============================================================================
" GENERAL SETTINGS
" ==============================================================================

filetype plugin indent on
syntax on
set noswapfile

" Leader key
let mapleader = "_"

" Disable netrw (using nvim-tree instead)
let g:loaded_netrw = 1
let g:loaded_netrwPlugin = 1

" Completion settings
set completeopt-=preview
let g:deoplete#enable_at_startup = 1

" Indentation
set tabstop=2
set shiftwidth=2
set expandtab

" Cursor
set guicursor=i:ver100-iCursor

" Terminal colors
set termguicolors

" ==============================================================================
" THEME CONFIGURATION
" ==============================================================================

colorscheme gruvbox
set background=dark

" ==============================================================================
" PLUGIN CONFIGURATIONS
" ==============================================================================

" Test Runner
let test#strategy = "neovim"
let g:test#python#runner = "pytest"
let test#project_root = "/Users/teddykim/projects/vibeacademy/agentic-patterns/tests"

" Limelight
let g:limelight_conceal_ctermfg = '#282828'
let g:limelight_conceal_ctermfg = 235
let g:limelight_default_coefficient = 0.7
let g:limelight_paragraph_span = 2
let g:limelight_bop = '^\s'
let g:limelight_eop = '\ze\n^\s'
let g:limelight_priority = -1


" Conceal markers
if has('conceal')
  set conceallevel=2 concealcursor=niv
endif

" ==============================================================================
" LUA CONFIGURATIONS
" ==============================================================================

" NvimTree setup
lua << EOF
require'nvim-tree'.setup {
  on_attach = function(bufnr)
    local api = require('nvim-tree.api')
    api.config.mappings.default_on_attach(bufnr)
    -- <leader>m on a file: open it, then show it in mdfried (same as <leader>m in the buffer).
    vim.keymap.set("n", "<leader>m", function()
      local node = api.tree.get_node_under_cursor()
      if not node or node.type ~= "file" then return end
      api.node.open.edit()
      MdfriedPreview()
    end, { buffer = bufnr, desc = "Open file and preview with mdfried", silent = true, nowait = true })
  end,
  actions = {
    open_file = {
      quit_on_open = true,
    },
  },
  filters = {
    dotfiles = true,
  }
}
EOF

" CodeDiff setup (VS Code-style diff viewer: :CodeDiff, :CodeDiff --staged, :CodeDiff pr <n>)
lua << EOF
local ok, codediff = pcall(require, 'codediff')
if ok then
  codediff.setup({})
end
EOF

" Glow markdown preview setup
lua << EOF
local ok, glow = pcall(require, 'glow')
if ok then
  glow.setup()
end
EOF

" mdfried markdown preview: <leader>m opens the current buffer in mdfried --watch.
" Uses a tmux side pane when inside tmux (passthrough is on, so Kitty graphics
" work); otherwise a Neovim :terminal vsplit.
lua << EOF
function MdfriedPreview()
  local file = vim.api.nvim_buf_get_name(0)
  if file == "" then
    vim.notify("Buffer has no file name; save it first", vim.log.levels.WARN)
    return
  end
  if vim.bo.modified then vim.cmd("write") end
  if vim.fn.executable("mdfried") == 0 then
    vim.notify("mdfried not found on PATH", vim.log.levels.ERROR)
    return
  end
  local cmd = { "mdfried", "--watch", file }
  if vim.env.TMUX then
    vim.fn.system({ "tmux", "split-window", "-h", table.concat(vim.tbl_map(vim.fn.shellescape, cmd), " ") })
  else
    -- jobstart(term=true) takes over the *current* buffer, so give it a fresh
    -- empty one instead of the markdown buffer that vsplit just mirrored.
    vim.cmd("vsplit | enew")
    vim.bo.bufhidden = "wipe"
    vim.fn.jobstart(cmd, { term = true })
    vim.cmd("startinsert")
  end
end
vim.keymap.set("n", "<leader>m", MdfriedPreview, { desc = "Preview markdown with mdfried", silent = true })
EOF

" Fugitive: side-by-side diff of a commit (or a file within it) vs its parent.
" Active only inside fugitive commit / log buffers, bound to `dv`.
lua << EOF
local function commit_sha()
  -- fugitive resolves the buffer's git object (the commit SHA)
  local ok, obj = pcall(vim.fn["fugitive#Object"], vim.fn.expand("%"))
  if ok and obj and obj:match("^%x%x%x%x%x%x") then return obj end
  -- fallback: parse the SHA off the fugitive buffer name (…//<sha>)
  return (vim.fn.expand("%")):match("//(%x+)$")
end

local function diff_commit_under_cursor()
  local sha, file
  local is_fugitive = vim.fn.expand("%"):match("^fugitive://") ~= nil

  if is_fugitive then
    -- Commit-object buffer: SHA from fugitive, file from the diff hunk
    sha = commit_sha()
    local l = vim.fn.search([[\v^diff --git ]], "bncW")
    file = (l > 0) and vim.fn.getline(l):match(" b/(.*)$") or nil
    if not file then
      vim.notify("Put the cursor inside a file's diff hunk", vim.log.levels.WARN)
      return
    end
  else
    -- Log/status buffer: SHA under cursor, alternate file (#)
    sha = vim.fn.expand("<cword>")
    if not sha:match("^%x%x%x%x%x%x%x") then
      vim.notify("No commit SHA under cursor", vim.log.levels.WARN)
      return
    end
    file = vim.fn.expand("#:.")
    if file == "" then file = vim.fn.expand("%:.") end
  end

  if not sha or sha == "" then
    vim.notify("Could not determine commit SHA", vim.log.levels.WARN)
    return
  end
  if not file or file == "" then
    vim.notify("Could not determine file", vim.log.levels.WARN)
    return
  end

  vim.cmd(("Gedit %s:%s"):format(sha, file))
  vim.cmd(("Gvdiffsplit %s~1:%s"):format(sha, file))
end

-- Bind `dv` only inside fugitive buffers so it never clashes with global keys.
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "git", "fugitive" },
  callback = function(ev)
    vim.keymap.set("n", "dv", diff_commit_under_cursor, {
      buffer = ev.buf,
      desc = "Side-by-side: commit/file under cursor vs parent",
    })
  end,
})
EOF

" ==============================================================================
" KEY MAPPINGS
" ==============================================================================

" Test runner mappings
nnoremap t<C-n> :TestNearest<CR>
nnoremap t<C-f> :TestFile<CR>
nnoremap t<C-s> :TestSuite<CR>
nnoremap t<C-l> :TestLast<CR>
nnoremap t<C-g> :TestVisit<CR>

" Search highlighting toggle
nnoremap <C-n> :set hlsearch!<CR>

" Line movement
nnoremap <S-Up> :m-2<CR>
nnoremap <S-Down> :m+<CR>
inoremap <S-Up> <Esc>:m-2<CR>
inoremap <S-Down> <Esc>:m+<CR>

" Buffer navigation
nnoremap <C-b> :Buffers<CR>
nnoremap <leader>bp :bprevious<CR>

" FZF mappings
nnoremap <C-p> :Files<CR>
nnoremap <silent> <leader>g :Rg! <C-R><C-W><CR>

" Explorer mappings
nnoremap <C-t> :NvimTreeToggle<CR>
nnoremap <leader>r :NvimTreeRefresh<CR>
nnoremap <leader>n :NvimTreeFindFile<CR>

" Documentation preview
nnoremap <silent> K :call <SID>show_documentation()<CR>

" Folding mappings
nnoremap <leader>f :set foldmethod=indent<CR>

" Line number toggle
nnoremap <leader>n :set number!<CR>

" Writing mode (Goyo + SoftPencil)
nnoremap <leader>z :Goyo<CR>:SoftPencil<CR>

" Claude Code mappings — plugin-free (claucode.nvim removed 2026-10-14).
" Visual <leader>e explains the selection; visual <leader>a picks a question
" (or lets you type one). Replies open as markdown in a scratch split to the
" right. Questions that need the rest of the repository let `claude -p` read
" and grep the project (read-only tools), never edit it.
"
"   :'<,'>ClaudeAsk            same as <leader>a
"   :'<,'>ClaudeAsk tests      run one preset directly (tab-completes)
"
" Add or edit presets in the `presets` table below.
lua << EOF
local presets = {
  { key = "explain", label = "Explain this code",
    repo = false,
    prompt = "Explain this code to a developer who knows the language but not this codebase. "
      .. "Say what it does, how, and anything surprising or risky. Be concise." },
  { key = "tests", label = "How well tested is this?",
    repo = true,
    prompt = "How well tested is this code? Find the tests that exercise it, directly or indirectly, "
      .. "and name them with file paths and line numbers. Then list the behaviours and edge cases "
      .. "that no test covers. Finish with a one-line verdict." },
  { key = "callers", label = "What are the incoming dependencies?",
    repo = true,
    prompt = "What are the incoming dependencies of this code? List every caller, importer, or "
      .. "reference in the repository with file path and line number, grouped by module. Note any "
      .. "callers outside the package it lives in. Say if there are none." },
  { key = "dead", label = "Is this dead code?",
    repo = true,
    prompt = "Is any of this code dead? For each function, class, branch, or parameter, say whether "
      .. "it is reachable from a live caller, a test, or an entry point, with file paths as evidence. "
      .. "Distinguish unused from untested. Finish with a verdict per item." },
  { key = "calls", label = "What does it call?",
    repo = true,
    prompt = "What does this code call? List every function, method, module, external service, "
      .. "file, or environment variable it depends on, grouped as: same file, same package, "
      .. "elsewhere in the repository, third-party libraries, and the outside world (network, "
      .. "filesystem, subprocesses). Resolve each in-repo callee to its file path and line. "
      .. "Flag anything called indirectly, through a callback, injection, or dynamic dispatch." },
  { key = "coupling", label = "How tightly coupled is it to the rest of the system?",
    repo = true,
    prompt = "How tightly coupled is this code to the rest of the system? Assess both directions: "
      .. "what it depends on (imports, shared state, data shapes, config, globals) and what depends "
      .. "on it (callers, consumers of its output, tests that pin its behaviour). Point out hidden "
      .. "coupling: shared mutable state, implicit ordering, duplicated knowledge such as a format "
      .. "or constant repeated elsewhere, and assumptions callers make that are not enforced here. "
      .. "Finish with a rating of low, medium, or high coupling, one sentence of justification, "
      .. "and the single change that would most reduce it." },
  { key = "failure", label = "What happens if it fails?",
    repo = true,
    prompt = "What happens if this code fails? Enumerate the ways it can fail: exceptions it raises "
      .. "or lets propagate, bad return values, partial writes, timeouts, resource leaks. For each, "
      .. "trace what the callers in the repository do: catch, retry, log, dead-letter, crash, or "
      .. "silently continue, with file paths. State the blast radius: what data or user-visible "
      .. "behaviour is affected and whether the failure is recoverable or leaves inconsistent "
      .. "state. Name the failure modes that are currently unhandled." },
  { key = "review", label = "Review for bugs and risks",
    repo = true,
    prompt = "Review this code for correctness bugs, unhandled edge cases, and risky assumptions. "
      .. "Check how callers in the repository use it before judging. Report findings most severe "
      .. "first, each with a concrete failing input. Say so if you find nothing." },
}

local repo_preamble = "You are inside the repository this code comes from. Investigate with "
  .. "Read, Grep, and Glob before answering, and cite file paths. The selected code follows.\n\n"

local function preset_by_key(key)
  for _, p in ipairs(presets) do if p.key == key then return p end end
end

-- Open a markdown scratch split to the right and fill it with Claude's answer.
-- `spec` is { key, label, prompt, repo }; `input` goes to claude on stdin;
-- `status` is the placeholder shown while it runs; `split` overrides how the
-- pane opens (default: to the right of the current window).
local function claude_run(spec, input, status, split)
  local claude = vim.fn.exepath("claude")
  if claude == "" then claude = vim.fn.expand("~/.local/bin/claude") end
  if vim.fn.executable(claude) == 0 then
    vim.notify("claude CLI not found on PATH or in ~/.local/bin", vim.log.levels.ERROR)
    return
  end

  vim.cmd((split or "rightbelow vsplit") .. " | enew")
  local buf = vim.api.nvim_get_current_buf()
  vim.bo[buf].buftype = "nofile"
  vim.bo[buf].bufhidden = "wipe"
  vim.bo[buf].swapfile = false
  vim.bo[buf].filetype = "markdown"
  vim.api.nvim_buf_set_name(buf, "claude://" .. (spec.key or "ask") .. "/" .. buf)
  vim.wo.wrap = true
  vim.wo.linebreak = true
  vim.keymap.set("n", "q", "<Cmd>close<CR>", { buffer = buf, silent = true, desc = "Close Claude pane" })
  local title = "# Claude: " .. spec.label
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { title, "", status })

  local cmd = { claude, "-p", (spec.repo and repo_preamble or "") .. spec.prompt, "--output-format", "text" }
  if spec.repo then
    vim.list_extend(cmd, { "--allowedTools", "Read,Grep,Glob" })
  end
  vim.system(cmd, { stdin = input, text = true, cwd = vim.fn.getcwd() }, function(res)
    vim.schedule(function()
      if not vim.api.nvim_buf_is_valid(buf) then return end
      local out = res.code == 0 and (res.stdout or "")
        or string.format("claude exited with code %d\n\n%s", res.code, res.stderr or "")
      local body = vim.split(vim.trim(out), "\n", { plain = true })
      vim.api.nvim_buf_set_lines(buf, 0, -1, false, vim.list_extend({ title, "" }, body))
    end)
  end)
end

-- Run one question against the current visual selection. `spec` is a preset
-- entry or { label = ..., prompt = ..., repo = true|false } for a typed question.
local function claude_ask(spec)
  local lines = vim.fn.getregion(vim.fn.getpos("v"), vim.fn.getpos("."), { type = vim.fn.mode() })
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<Esc>", true, false, true), "n", false)
  if #lines == 0 then return end

  local name = vim.fn.expand("%")
  local ft = vim.bo.filetype
  local input = string.format("File: %s\nLanguage: %s\n\n%s\n",
    name ~= "" and name or "[No Name]", ft ~= "" and ft or "unknown", table.concat(lines, "\n"))
  claude_run(spec, input, string.format("Asking Claude about %d line%s%s...", #lines,
    #lines == 1 and "" or "s", spec.repo and " (reading the repository)" or ""))
end

-- Explain the file or directory under the cursor in nvim-tree. Claude gets the
-- path and reads it itself, so any kind of file works (code, config, markdown,
-- images, PDFs) and directories are surveyed rather than pasted.
local function claude_explain_tree_node()
  local ok, api = pcall(require, "nvim-tree.api")
  local node = ok and api.tree.get_node_under_cursor() or nil
  if not node or not node.absolute_path then return end
  local path = vim.fn.fnamemodify(node.absolute_path, ":.")
  local is_dir = node.type == "directory"

  -- Open the answer beside the main window, not inside the narrow tree.
  for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
    local ft = vim.bo[vim.api.nvim_win_get_buf(win)].filetype
    if ft ~= "NvimTree" and vim.api.nvim_win_get_config(win).relative == "" then
      vim.api.nvim_set_current_win(win)
      break
    end
  end
  -- Only the tree is open: put the pane at the far right instead.
  local split = vim.bo.filetype == "NvimTree" and "botright vsplit" or nil

  local prompt = is_dir
    and ("Explain the directory named on stdin to a developer new to this codebase. Survey it with "
      .. "Glob, and Read its key files. Say what it contains, what role it plays in the repository, "
      .. "its main entry points, and how it connects to the rest. Be concise.")
    or ("Explain the file named on stdin to a developer who knows the language but not this codebase. "
      .. "Read it first; it may be code, configuration, documentation, data, or an image. Say what it "
      .. "is for, how it works, how it fits into the repository, and anything surprising or risky. "
      .. "Be concise.")
  claude_run({ key = "explain", label = "Explain " .. path, prompt = prompt, repo = true },
    string.format("%s: %s\n", is_dir and "Directory" or "File", path),
    string.format("Asking Claude about %s (reading the repository)...", path), split)
end

vim.api.nvim_create_autocmd("FileType", {
  pattern = "NvimTree",
  callback = function(ev)
    vim.keymap.set("n", "<leader>e", claude_explain_tree_node,
      { buffer = ev.buf, silent = true, desc = "Explain file or directory with Claude" })
  end,
})

-- Picker: presets plus a free-form question. Typed questions get repository
-- access, since that is what most ad hoc questions need.
local function claude_pick()
  local items = vim.list_extend(vim.deepcopy(presets), { { key = "custom", label = "Type a question..." } })
  vim.ui.select(items, { prompt = "Ask Claude about the selection", format_item = function(i) return i.label end },
    function(choice)
      if not choice then return end
      if choice.key ~= "custom" then return claude_ask(choice) end
      vim.ui.input({ prompt = "Question: " }, function(q)
        if q and q ~= "" then claude_ask({ key = "ask", label = q, prompt = q, repo = true }) end
      end)
    end)
end

vim.keymap.set("x", "<leader>e", function() claude_ask(preset_by_key("explain")) end,
  { desc = "Explain selection with Claude", silent = true })
vim.keymap.set("x", "<leader>a", claude_pick, { desc = "Ask Claude about selection", silent = true })
vim.api.nvim_create_user_command("ClaudeAsk", function(opts)
  if opts.args == "" then return claude_pick() end
  local p = preset_by_key(opts.args)
  if not p then return vim.notify("ClaudeAsk: no preset named " .. opts.args, vim.log.levels.ERROR) end
  claude_ask(p)
end, { range = true, nargs = "?", complete = function() return vim.tbl_map(function(p) return p.key end, presets) end })
_G.ClaudeAsk = claude_ask  -- for scripting and headless tests
EOF

" Remove whitespace-only lines
nnoremap <leader>ws :%s/^\s\+$//<CR>

" Remove trailing whitespace
nnoremap <leader>wt :%s/\s\+$//<CR>

" ==============================================================================
" CUSTOM COMMANDS
" ==============================================================================

" FZF with preview
command! -bang -nargs=* Rg
  \ call fzf#vim#grep(
  \   'rg --column --line-number --no-heading --color=always --smart-case '.shellescape(<q-args>), 1,
  \   <bang>0 ? fzf#vim#with_preview('up:60%')
  \           : fzf#vim#with_preview('right:50%:hidden', '?'),
  \   <bang>0)

command! -bang -nargs=? -complete=dir Files
  \ call fzf#vim#files(<q-args>, fzf#vim#with_preview(), <bang>0)

" ==============================================================================
" AUTOCOMMANDS
" ==============================================================================

" Highlight trailing whitespace
highlight RedundantSpaces ctermbg=red guibg=red
match RedundantSpaces /\s\+$/

" Goyo integration
autocmd! User GoyoEnter nested call <SID>goyo_enter()
autocmd! User GoyoLeave nested call <SID>goyo_leave()

" ==============================================================================
" FUNCTIONS
" ==============================================================================

function! CheckBackSpace() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~# '\s'
endfunction

function! s:goyo_enter()
  if executable('tmux') && strlen($TMUX)
    silent !tmux set status off
    silent !tmux list-panes -F '\#F' | grep -q Z || tmux resize-pane -Z
  endif
  set noshowmode
  set noshowcmd
  set scrolloff=999
  SoftPencil
endfunction

function! s:goyo_leave()
  if executable('tmux') && strlen($TMUX)
    silent !tmux set status on
    silent !tmux list-panes -F '\#F' | grep -q Z && tmux resize-pane -Z
  endif
  set showmode
  set showcmd
  set scrolloff=5
  SoftPencil
endfunction

" ── Branch picker: :Branches → j/k to move, <CR> to switch local ──
function! s:BranchSwitch() abort
  let l:branch = trim(getline('.'))
  if empty(l:branch) | return | endif
  close
  execute 'Git switch ' . fnameescape(l:branch)
endfunction

function! s:BranchList() abort
  let l:branches = systemlist('git branch --format="%(refname:short)"')
  if v:shell_error
    echohl ErrorMsg | echomsg 'git branch failed' | echohl None | return
  endif
  botright 12new
  setlocal buftype=nofile bufhidden=wipe noswapfile nobuflisted nonumber
  call setline(1, l:branches)
  setlocal nomodifiable
  let l:head = get(systemlist('git rev-parse --abbrev-ref HEAD'), 0, '')
  call search('\V\^' . escape(l:head, '\') . '\$', 'cw')
  nnoremap <buffer> <silent> <CR> :call <SID>BranchSwitch()<CR>
  nnoremap <buffer> <silent> q :close<CR>
endfunction
command! Branches call s:BranchList()

" ── PR picker: :PRs [gh pr list flags] → fzf over PRs, <CR> to review in CodeDiff ──
function! s:PRReview(line) abort
  let l:num = matchstr(a:line, '^\d\+')
  if empty(l:num) | return | endif
  execute 'CodeDiff pr ' . l:num
endfunction

function! s:PRList(args) abort
  let l:out = system('gh pr list --json number,title,author,headRefName ' . a:args)
  if v:shell_error
    echohl ErrorMsg | echomsg 'gh pr list failed: ' . get(split(l:out, "\n"), 0, '') | echohl None | return
  endif
  let l:prs = map(json_decode(l:out),
    \ {_, pr -> printf('%-5d %s  [%s · %s]', pr.number, pr.title, pr.author.login, pr.headRefName)})
  if empty(l:prs)
    echomsg 'No pull requests' | return
  endif
  call fzf#run(fzf#wrap({
    \ 'source': l:prs,
    \ 'sink': function('s:PRReview'),
    \ 'options': ['--prompt', 'PRs> ', '--preview',
    \             'env GH_FORCE_TTY=100% gh pr view {1} | perl -CS -pe ''s/[\x{200B}-\x{200D}\x{FEFF}]//g''',
    \             '--preview-window', 'up,70%,wrap'],
    \ }))
endfunction
command! -nargs=* PRs call s:PRList(<q-args>)
