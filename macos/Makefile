APP = dist/Useful Brain.app

# Sign with the stable self-signed identity if it exists, otherwise fall back
# to ad-hoc. No Accessibility grant is needed, so ad-hoc is fine for now.
SIGN_IDENTITY = $(shell security find-identity -p codesigning 2>/dev/null | grep -q "Useful Brain Local Signing" && echo "Useful Brain Local Signing" || echo "-")

# Command Line Tools (no Xcode.app) don't put Testing.framework on the dyld
# search path. We compile against it with -F and copy it next to the test
# bundle (@loader_path/../../../ rpath) so the runner can load it. Installing
# full Xcode makes all of this unnecessary but harmless.
CLT_FRAMEWORKS = /Library/Developer/CommandLineTools/Library/Developer/Frameworks
CLT_INTEROP = /Library/Developer/CommandLineTools/Library/Developer/usr/lib/lib_TestingInterop.dylib
DEBUG_DIR = $(shell swift build --show-bin-path --build-tests 2>/dev/null)
SWIFT_TEST_FLAGS = -Xswiftc -F -Xswiftc $(CLT_FRAMEWORKS)

.PHONY: build test icon bundle run install clean

build:
	swift build -c release

test:
	swift build --build-tests $(SWIFT_TEST_FLAGS)
	cp -R "$(CLT_FRAMEWORKS)/Testing.framework" "$(DEBUG_DIR)/" 2>/dev/null || true
	cp "$(CLT_INTEROP)" "$(DEBUG_DIR)/" 2>/dev/null || true
	@test -d "$(DEBUG_DIR)/Testing.framework" || { echo "Testing.framework missing from $(DEBUG_DIR); install full Xcode or check CLT_FRAMEWORKS" >&2; exit 1; }
	swift test --skip-build $(SWIFT_TEST_FLAGS)

icon:
	./scripts/make-icns.sh

bundle: build
	rm -rf "$(APP)"
	mkdir -p "$(APP)/Contents/MacOS" "$(APP)/Contents/Resources"
	cp bundle/Info.plist "$(APP)/Contents/Info.plist"
	cp .build/release/UsefulBrainApp "$(APP)/Contents/MacOS/UsefulBrainApp"
	cp assets/AppIcon.icns "$(APP)/Contents/Resources/AppIcon.icns"
	codesign --force --deep --sign "$(SIGN_IDENTITY)" "$(APP)"

run: bundle
	open "$(APP)"

install: bundle
	pkill -x UsefulBrainApp || true
	rm -rf "/Applications/Useful Brain.app"
	cp -R "$(APP)" "/Applications/Useful Brain.app"
	open "/Applications/Useful Brain.app"

clean:
	rm -rf .build dist
