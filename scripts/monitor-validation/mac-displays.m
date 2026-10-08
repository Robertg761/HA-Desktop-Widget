// Test-only CoreGraphics virtual outputs, following the API used by Chromium's
// ui/display/mac/test/virtual_display_util_mac.mm. Never included in the app.
#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ColorSync/ColorSync.h>
#import <dlfcn.h>
@interface CGVirtualDisplayDescriptor : NSObject
@property unsigned int vendorID, productID, serialNum, serialNumber, maxPixelsWide, maxPixelsHigh;
@property(strong) NSString *name;
@property CGSize sizeInMillimeters;
@property CGPoint redPrimary, greenPrimary, bluePrimary, whitePoint;
@property(strong) id queue;
@end
@interface CGVirtualDisplayMode : NSObject
- (id)initWithWidth:(unsigned int)width height:(unsigned int)height refreshRate:(double)rate;
@end
@interface CGVirtualDisplaySettings : NSObject
@property unsigned int hiDPI;
@property(strong) NSArray *modes;
@end
@interface CGVirtualDisplay : NSObject
@property(readonly) unsigned int displayID;
- (id)initWithDescriptor:(CGVirtualDisplayDescriptor *)descriptor;
- (BOOL)applySettings:(CGVirtualDisplaySettings *)settings;
@end
static NSMutableDictionary<NSString *, CGVirtualDisplay *> *displays;
static int targetOriginalX;
static BOOL targetWasConfigured;
static NSDictionary *createDisplay(NSString *key, BOOL retina, int x, int y) {
  CGVirtualDisplayDescriptor *d = [NSClassFromString(@"CGVirtualDisplayDescriptor") new];
  d.name = [@"HA184-" stringByAppendingString:key];
  d.vendorID = 184; d.productID = key.intValue; d.serialNum = key.intValue; d.serialNumber = key.intValue;
  d.maxPixelsWide = retina ? 2560 : 1920; d.maxPixelsHigh = retina ? 1600 : 1080;
  d.sizeInMillimeters = CGSizeMake(500,300);
  d.redPrimary=CGPointMake(.6797,.3203);d.greenPrimary=CGPointMake(.2559,.6983);d.bluePrimary=CGPointMake(.1494,.0557);d.whitePoint=CGPointMake(.3125,.3291);
  d.queue = dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE,0);
  CGVirtualDisplay *display = [[NSClassFromString(@"CGVirtualDisplay") alloc] initWithDescriptor:d];
  if (!display) return @{@"error":@"CGVirtualDisplay creation failed"};
  CGVirtualDisplaySettings *s = [NSClassFromString(@"CGVirtualDisplaySettings") new];
  s.hiDPI = retina;
  s.modes = @[[[NSClassFromString(@"CGVirtualDisplayMode") alloc] initWithWidth:retina?1280:1920 height:retina?800:1080 refreshRate:60]];
  if (![display applySettings:s]) return @{@"error":@"CGVirtualDisplay applySettings failed"};
  NSMutableArray *modeInfo=[NSMutableArray new];
  CGError scaleResult=kCGErrorSuccess;
  CFArrayRef modes=CGDisplayCopyAllDisplayModes(display.displayID,(__bridge CFDictionaryRef)@{(__bridge NSString*)kCGDisplayShowDuplicateLowResolutionModes:@YES});
  if(modes){
   for(CFIndex i=0;i<CFArrayGetCount(modes);i++){
    CGDisplayModeRef mode=(CGDisplayModeRef)CFArrayGetValueAtIndex(modes,i);
    size_t w=CGDisplayModeGetWidth(mode),pw=CGDisplayModeGetPixelWidth(mode);
    [modeInfo addObject:@{@"width":@(w),@"height":@(CGDisplayModeGetHeight(mode)),@"pixels":@(pw)}];
    if(retina && w==1280 && pw==2560) scaleResult=CGDisplaySetDisplayMode(display.displayID,mode,NULL);
   }
   CFRelease(modes);
  }
  displays[key]=display;
  CGDisplayConfigRef config;
  CGError error= CGBeginDisplayConfiguration(&config);
  if(error==kCGErrorSuccess){CGConfigureDisplayOrigin(config,display.displayID,x,y);error=CGCompleteDisplayConfiguration(config,kCGConfigureForSession);}
  return @{@"id":@(display.displayID),@"requestedRetina":@(retina),@"layoutResult":@(error),@"scaleResult":@(scaleResult),@"modes":modeInfo};
}
static NSDictionary *command(NSDictionary *c) {
 NSString *op=c[@"op"];
 if([op isEqual:@"setup"]){
  int origin=CGDisplayBounds(CGMainDisplayID()).size.width;
  targetOriginalX=origin+1920;
  targetWasConfigured=YES;
  NSDictionary *one=createDisplay(@"1",NO,origin,0);
  NSDictionary *two=createDisplay(@"2",YES,targetOriginalX,0);
  return @{@"one":one,@"two":two};
 }
 if([op isEqual:@"identities"]){
  // Independent native oracle for the production JXA provider. This uses the
  // same OS API but none of its enumeration, bridge, or JSON parsing code.
  CGDirectDisplayID active[1024];
  CGDisplayCount count=0;
  CGError result=CGGetActiveDisplayList(1024,active,&count);
  if(result!=kCGErrorSuccess)return @{@"error":@"CGGetActiveDisplayList failed",@"result":@(result)};
  NSMutableDictionary *identities=[NSMutableDictionary new];
  for(CGDisplayCount index=0;index<count;index++){
   CFUUIDRef uuid=CGDisplayCreateUUIDFromDisplayID(active[index]);
   if(!uuid)return @{@"error":@"CGDisplayCreateUUIDFromDisplayID failed",@"id":@(active[index])};
   CFStringRef value=CFUUIDCreateString(kCFAllocatorDefault,uuid);
   CFRelease(uuid);
   if(!value)return @{@"error":@"CFUUIDCreateString failed",@"id":@(active[index])};
   identities[[@(active[index]) stringValue]]=[(__bridge NSString *)value lowercaseString];
   CFRelease(value);
  }
  return identities;
 }
 if([op isEqual:@"destroy-target"]){
  if(!displays[@"2"])return @{@"error":@"Target display is already absent"};
  CGDirectDisplayID previous=displays[@"2"].displayID;
  [displays removeObjectForKey:@"2"];
  // ARC releases the last retained virtual display here. The caller must wait
  // for its removal from Electron before sending recreate-target; the main
  // run loop stays free between these two commands to deliver notifications.
  return @{@"id":@(previous),@"destroyed":@YES};
 }
 if([op isEqual:@"recreate-target"]){
  if(!targetWasConfigured)return @{@"error":@"Run setup before recreating the target"};
  if(displays[@"2"])return @{@"error":@"Destroy the target and await removal before recreating"};
  // Key 2 restores the original vendor/product/serial values, even when the
  // WindowServer assigns a different transient CGDirectDisplayID.
  return createDisplay(@"2",YES,targetOriginalX,0);
 }
 if([op isEqual:@"off"] || [op isEqual:@"on"]){
  typedef CGError (*EnableFn)(CGDisplayConfigRef,CGDirectDisplayID,bool);
  EnableFn enable=(EnableFn)dlsym(RTLD_DEFAULT,"CGSConfigureDisplayEnabled");
  if(!enable){void *library=dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight",RTLD_LAZY);enable=(EnableFn)dlsym(library,"CGSConfigureDisplayEnabled");}
  if(!enable)return @{@"error":@"No CGSConfigureDisplayEnabled symbol"};
  CGDisplayConfigRef cfg;CGError e=CGBeginDisplayConfiguration(&cfg);CGError applied=e;
  if(e==kCGErrorSuccess){e=enable(cfg,displays[@"2"].displayID,[op isEqual:@"on"]);applied=CGCompleteDisplayConfiguration(cfg,kCGConfigureForSession);}
  return @{@"id":@(displays[@"2"].displayID),@"result":@(e),@"applied":@(applied)};
 }
 if([op isEqual:@"layout"]){
  CGDisplayConfigRef cfg;CGError e=CGBeginDisplayConfiguration(&cfg);
  if(e==kCGErrorSuccess){CGConfigureDisplayOrigin(cfg,displays[@"2"].displayID,-1280,0);e=CGCompleteDisplayConfiguration(cfg,kCGConfigureForSession);}return @{@"result":@(e)};
 }
 if([op isEqual:@"retina"]){
  CGDirectDisplayID displayID=displays[@"2"].displayID;
  NSMutableArray *info=[NSMutableArray new];int applied=-1;
  CFArrayRef modes=CGDisplayCopyAllDisplayModes(displayID,(__bridge CFDictionaryRef)@{(__bridge NSString*)kCGDisplayShowDuplicateLowResolutionModes:@YES});
  if(modes){for(CFIndex i=0;i<CFArrayGetCount(modes);i++){
   CGDisplayModeRef mode=(CGDisplayModeRef)CFArrayGetValueAtIndex(modes,i);
   size_t width=CGDisplayModeGetWidth(mode),pixels=CGDisplayModeGetPixelWidth(mode);
   [info addObject:@{@"width":@(width),@"height":@(CGDisplayModeGetHeight(mode)),@"pixels":@(pixels)}];
   if(width==1280 && pixels==2560)applied=CGDisplaySetDisplayMode(displayID,mode,NULL);
  }CFRelease(modes);}
  return @{@"id":@(displayID),@"applied":@(applied),@"modes":info};
 }
 if([op isEqual:@"list"]){NSMutableDictionary *r=[NSMutableDictionary new];for(NSString *key in displays)r[key]=@(displays[key].displayID);return r;}
 if([op isEqual:@"quit"]){[displays removeAllObjects];dispatch_after(dispatch_time(DISPATCH_TIME_NOW,100*NSEC_PER_MSEC),dispatch_get_main_queue(),^{exit(0);});return @{@"ok":@YES};}
 return @{@"error":@"Unknown operation"};
}
int main(){@autoreleasepool{
 displays=[NSMutableDictionary new];
 dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT,0),^{
  char *line=NULL;size_t size=0;
  while(getline(&line,&size,stdin)>0){
   @autoreleasepool{
    NSData *data=[[NSString stringWithUTF8String:line] dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *c=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    dispatch_sync(dispatch_get_main_queue(),^{@autoreleasepool{
     NSDictionary *r=command(c);NSData *bytes=[NSJSONSerialization dataWithJSONObject:r options:0 error:nil];
     fwrite(bytes.bytes,1,bytes.length,stdout);fputs("\n",stdout);fflush(stdout);
    }});
   }
  }
  free(line);exit(0);
 });
 [[NSRunLoop mainRunLoop] run];
}return 0;}
